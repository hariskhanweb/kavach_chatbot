'use client'

import { useState, useRef, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import Image from 'next/image'
import ChatMessage from './ChatMessage'
import { CHATBOT_NAME } from '@/lib/chatbots'
import {
  initiateActivation,
  submitAnswer,
  uploadVoiceNoteToS3,
  type Question,
  type SubmitAnswerResponse,
  type ActivationDetails,
  type InitiateResponse,
} from '@/lib/kavach-api'
import { VoiceRecorder } from '@/lib/voice-recorder'

interface Message {
  id: string
  text: string
  isUser: boolean
  timestamp: string
  type?: 'question' | 'answer' | 'system' | 'completion'
  question?: Question
  activationDetails?: ActivationDetails
  /** Object URL for voice note playback (user messages) */
  voiceNoteBlobUrl?: string
}

export default function ChatInterface() {
  const searchParams = useSearchParams()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number>(0)
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [isMounted, setIsMounted] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const [customerUuid, setCustomerUuid] = useState<string | null>(null)
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null)
  const [currentPhase, setCurrentPhase] = useState<string>('')
  const [isComplete, setIsComplete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const validationErrorTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textInputRef = useRef<HTMLTextAreaElement>(null)
  const dateInputRef = useRef<HTMLInputElement>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  // Kept for runtime compatibility (e.g. other copies of this component); stop now sends directly
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const voiceRecorderRef = useRef<VoiceRecorder | null>(null)
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const getCurrentTime = () => {
    const timeString = new Date().toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    })
    return timeString.toLowerCase()
  }

  // Validation functions
  const validateAnswer = (answer: string, question: Question): string | null => {
    const field = question.field.toLowerCase()
    const type = question.type
    const trimmed = answer.trim()

    // Required field validation (check first)
    if (question.required && !trimmed) {
      return 'This field is required'
    }

    // Skip further validation if empty and not required
    if (!trimmed && !question.required) {
      return null
    }

    // Text validation - character limits
    if (type === 'text') {
      const maxLength = 500 // Reasonable limit for text fields
      if (trimmed.length > maxLength) {
        return `Text cannot exceed ${maxLength} characters (current: ${trimmed.length})`
      }
      // Check for valid text (not just whitespace or special chars only)
      if (trimmed.length > 0 && /^\s*$/.test(trimmed)) {
        return 'Please enter valid text'
      }
    }

    // Textarea validation - larger character limits
    if (type === 'textarea') {
      const maxLength = 2000 // Larger limit for textarea
      if (trimmed.length > maxLength) {
        return `Text cannot exceed ${maxLength} characters (current: ${trimmed.length})`
      }
      if (trimmed.length > 0 && /^\s*$/.test(trimmed)) {
        return 'Please enter valid text'
      }
    }

    // Number validation - check for valid number format and reasonable limits
    if (type === 'number') {
      const numValue = trimmed
      
      // Check if it's a valid number (allows decimals, negative, scientific notation)
      if (!/^-?\d*\.?\d+([eE][+-]?\d+)?$/.test(numValue) && numValue !== '') {
        return 'Please enter a valid number (e.g., 123, 45.67, -10)'
      }
      
      const num = Number(numValue)
      if (isNaN(num)) {
        return 'Please enter a valid number'
      }
      
      // Reasonable number limits (adjust as needed)
      const maxValue = 999999999999 // 12 digits max
      const minValue = -999999999999
      if (num > maxValue) {
        return `Number cannot exceed ${maxValue.toLocaleString()}`
      }
      if (num < minValue) {
        return `Number cannot be less than ${minValue.toLocaleString()}`
      }
      
      // Check for excessive decimal places (limit to 2 for most cases)
      if (numValue.includes('.') && numValue.split('.')[1]?.length > 10) {
        return 'Number cannot have more than 10 decimal places'
      }
    }

    // Email validation
    if (type === 'email' || field.includes('email')) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(trimmed)) {
        return 'Please enter a valid email address (e.g., example@domain.com)'
      }
      // Email length limit (RFC 5321)
      if (trimmed.length > 254) {
        return 'Email address cannot exceed 254 characters'
      }
    }

    // Phone validation - mobile phone number with max 13 digits, allows + sign
    if (field.includes('phone') || field.includes('mobile') || field.includes('contact') || question.question.toLowerCase().includes('phone number')) {
      // Check if only numbers and + sign are allowed (and + only at start)
      const phoneRegex = /^\+?[0-9]+$/
      if (!phoneRegex.test(trimmed)) {
        return 'Phone number can only contain numbers and an optional + sign at the start'
      }
      
      // Count only digits (not + sign)
      const digitsOnly = trimmed.replace(/\D/g, '')
      if (digitsOnly.length === 0) {
        return 'Please enter a valid phone number'
      }
      
      // Max 13 digits
      if (digitsOnly.length > 13) {
        return 'Phone number cannot exceed 13 digits'
      }
      
      // Minimum validation (at least some digits)
      if (digitsOnly.length < 10) {
        return 'Please enter a valid phone number (minimum 10 digits)'
      }
    }

    // Pincode validation
    if (field.includes('pincode') || field.includes('pin') || field.includes('postal')) {
      const pincodeRegex = /^\d{6}$/
      if (!pincodeRegex.test(trimmed)) {
        return 'Please enter a valid 6-digit pincode'
      }
    }

    // Invoice number validation - only numbers allowed
    if (field.includes('invoice') && field.includes('number')) {
      const invoiceNumberRegex = /^\d+$/
      if (!invoiceNumberRegex.test(trimmed)) {
        return 'Invoice number can only contain numbers'
      }
      // Reasonable length limit for invoice numbers
      if (trimmed.length > 50) {
        return 'Invoice number cannot exceed 50 digits'
      }
      if (trimmed.length === 0) {
        return 'Please enter an invoice number'
      }
    }

    // Warranty period validation - number between 1 and 36
    if (
      (field.includes('warranty') && field.includes('period')) ||
      question.question.toLowerCase().includes('warranty period')
    ) {
      const warrantyRegex = /^\d+$/
      if (!warrantyRegex.test(trimmed)) {
        return 'Warranty period must be a number'
      }
      const warrantyMonths = parseInt(trimmed, 10)
      if (isNaN(warrantyMonths)) {
        return 'Please enter a valid number for warranty period'
      }
      if (warrantyMonths < 1) {
        return 'Warranty period must be at least 1 month'
      }
      if (warrantyMonths > 36) {
        return 'Warranty period cannot exceed 36 months'
      }
    }

    // Date validation (for text input dates)
    if (type === 'date') {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/
      if (!dateRegex.test(trimmed)) {
        return 'Please enter a valid date in YYYY-MM-DD format'
      }
      const date = new Date(trimmed)
      if (isNaN(date.getTime())) {
        return 'Please enter a valid date'
      }
    }

    // General character limit for other text-based types (fallback)
    if (type !== 'file' && type !== 'choice' && type !== 'select' && !['email', 'number', 'date', 'phone'].includes(type)) {
      const maxLength = 1000 // Default limit for unspecified text types
      if (trimmed.length > maxLength) {
        return `Input cannot exceed ${maxLength} characters (current: ${trimmed.length})`
      }
    }

    return null
  }


  // Initialize activation on mount using partner_id from URL
  useEffect(() => {
    setIsMounted(true)
    if (isInitialized) return

    const initializeActivation = async () => {
      setIsLoading(true)
      setError(null)

      const partnerId = searchParams.get('partner_id')
      if (!partnerId) {
        setError('Missing partner_id parameter in URL. Please provide ?partner_id=YOUR_PARTNER_ID')
        setIsLoading(false)
        return
      }

      try {
        const response: InitiateResponse = await initiateActivation(partnerId)
        setCustomerUuid(response.customer_uuid)
        setCurrentPhase(response.current_phase)
        setCurrentQuestion(response.question)
        localStorage.setItem('chatbot_customer_uuid', response.customer_uuid)
        localStorage.setItem('chatbot_partner_id', response.partner_id)
        localStorage.setItem('chatbot_partner_email', response.partner_email)
        setIsInitialized(true)
        setMessages([
          {
            id: '1',
            text: response.question.question,
            isUser: false,
            timestamp: getCurrentTime(),
            type: 'question',
            question: response.question,
          },
        ])
        if (response.question.type !== 'choice' && response.question.type !== 'file') {
          setTimeout(() => {
            if (response.question.type === 'date') {
              dateInputRef.current?.focus()
            } else {
              textInputRef.current?.focus()
            }
          }, 100)
        }
      } catch (error) {
        console.error('Error initiating activation:', error)
        setError(
          error instanceof Error
            ? error.message
            : 'Failed to initiate activation. Please check your partner_id and try again.'
        )
      } finally {
        setIsLoading(false)
      }
    }

    initializeActivation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Cleanup validation timeout on unmount
  useEffect(() => {
    return () => {
      if (validationErrorTimeoutRef.current) {
        clearTimeout(validationErrorTimeoutRef.current)
      }
    }
  }, [])

  const handleSubmitAnswer = async (answer: string | File | File[]) => {
    if (!customerUuid || !currentQuestion) return

    // Clear any existing validation error timeout
    if (validationErrorTimeoutRef.current) {
      clearTimeout(validationErrorTimeoutRef.current)
      validationErrorTimeoutRef.current = null
    }

    // Remove previous validation error messages
    setMessages((prev) => prev.filter((msg) => msg.type !== 'system' || !msg.text.includes('Please enter')))

    // Validate text answers before submission
    if (typeof answer === 'string' && currentQuestion.type !== 'file') {
      const validationError = validateAnswer(answer, currentQuestion)
      if (validationError) {
        const errorMessageId = `validation-${Date.now()}`
        const errorMessage: Message = {
          id: errorMessageId,
          text: validationError,
          isUser: false,
          timestamp: getCurrentTime(),
          type: 'system',
        }
        setMessages((prev) => [...prev, errorMessage])
        
        // Auto-remove validation error after 5 seconds
        validationErrorTimeoutRef.current = setTimeout(() => {
          setMessages((prev) => prev.filter((msg) => msg.id !== errorMessageId))
          validationErrorTimeoutRef.current = null
        }, 5000)
        
        return
      }
    }

    const isFileUpload = answer instanceof File || Array.isArray(answer)
    setIsLoading(true)
    setIsUploading(isFileUpload)
    setUploadProgress(0)

    try {
      // Create user message for file(s)
      let userMessageText = ''
      if (answer instanceof File) {
        userMessageText = `📎 ${answer.name}`
        setUploadingFiles([answer.name])
      } else if (Array.isArray(answer)) {
        userMessageText = `📎 ${answer.length} file(s): ${answer.map((f) => f.name).join(', ')}`
        setUploadingFiles(answer.map((f) => f.name))
      } else if (typeof answer === 'string' && answer.startsWith('http')) {
        userMessageText = `📎 File uploaded via S3: ${answer}`
      } else {
        userMessageText = typeof answer === 'string' ? answer : ''
      }

      const userMessage: Message = {
        id: Date.now().toString(),
        text: userMessageText,
        isUser: true,
        timestamp: getCurrentTime(),
        type: 'answer',
      }

      setMessages((prev) => [...prev, userMessage])
      setInput('')

      // Remove any validation error messages when submitting a valid answer
      setMessages((prev) => prev.filter((msg) => msg.type !== 'system' || !msg.text.includes('Please enter')))
      if (validationErrorTimeoutRef.current) {
        clearTimeout(validationErrorTimeoutRef.current)
        validationErrorTimeoutRef.current = null
      }

      // Submit answer (handles S3 direct upload for file type questions)
      const response: SubmitAnswerResponse = await submitAnswer(
        customerUuid,
        currentQuestion.field,
        answer,
        currentQuestion.type
      )

      setCurrentPhase(response.current_phase)

      // Check if activation is complete
      if (response.activation_details) {
        setIsComplete(true)
        const completionMessage: Message = {
          id: (Date.now() + 1).toString(),
          text: `✅ Activation completed successfully!\n\n📋 Activation Details:\n• Activation ID: ${response.activation_details.activation_id}\n• Sale ID: ${response.activation_details.sale_id}\n• Policy Serial: ${response.activation_details.policy_serial}\n• Plan: ${response.activation_details.plan_name}\n• Price: ₹${response.activation_details.customer_price}\n• Activation Date: ${response.activation_details.activation_date}\n• Expiry Date: ${response.activation_details.expiry_date}`,
          isUser: false,
          timestamp: getCurrentTime(),
          type: 'completion',
          activationDetails: response.activation_details,
        }
        setMessages((prev) => [...prev, completionMessage])
        setCurrentQuestion(null)
      } else if (response.next_question) {
        // Show phase transition message if provided (but skip "Answer saved" messages)
        if (response.message && !response.message.toLowerCase().includes('answer saved')) {
          const phaseMessage: Message = {
            id: (Date.now() + 1).toString(),
            text: response.message,
            isUser: false,
            timestamp: getCurrentTime(),
            type: 'completion', // Use completion type to highlight phase transitions
          }
          setMessages((prev) => [...prev, phaseMessage])
        }

        // Show next question
        const nextQuestion = response.next_question
        if (nextQuestion) {
          setCurrentQuestion(nextQuestion)
          const questionMessage: Message = {
            id: (Date.now() + 2).toString(),
            text: nextQuestion.question,
            isUser: false,
            timestamp: getCurrentTime(),
            type: 'question',
            question: nextQuestion,
          }
          setMessages((prev) => [...prev, questionMessage])
          
          // Focus input for next question (only if not choice or file type)
          if (nextQuestion.type !== 'choice' && nextQuestion.type !== 'file') {
            setTimeout(() => {
              if (nextQuestion.type === 'date') {
                dateInputRef.current?.focus()
              } else {
                textInputRef.current?.focus()
              }
            }, 100)
          }
        }
      } else {
        // No next question - mark as complete
        setIsComplete(true)
      }
    } catch (error) {
      console.error('Error submitting answer:', error)
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Failed to submit answer'}. Please try again.`,
        isUser: false,
        timestamp: getCurrentTime(),
        type: 'system',
      }
      setMessages((prev) => [...prev, errorMessage])
      
      // Focus input after error so user can retry quickly
      if (currentQuestion && currentQuestion.type !== 'choice' && currentQuestion.type !== 'file') {
        setTimeout(() => {
          if (currentQuestion.type === 'date') {
            dateInputRef.current?.focus()
          } else {
            textInputRef.current?.focus()
          }
        }, 100)
      }
    } finally {
      setIsLoading(false)
      setIsUploading(false)
      setUploadProgress(0)
      setUploadingFiles([])
    }
  }

  const handleSend = async () => {
    if (!input.trim() || isLoading || isComplete || !currentQuestion) return
    await handleSubmitAnswer(input.trim())
  }

  const handleChoiceSelect = async (choice: string | number) => {
    if (isLoading || isComplete || !currentQuestion) return
    // Convert choice to string for submission
    await handleSubmitAnswer(String(choice))
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0 || !currentQuestion || isLoading || isComplete) return

    // Check if current question expects a file (only when type is 'file')
    const isFileQuestion = currentQuestion.type === 'file'
    
    if (isFileQuestion) {
      // Convert FileList to Array
      const fileArray = Array.from(files)
      
      // Support single or multiple files
      if (fileArray.length === 1) {
        await handleSubmitAnswer(fileArray[0])
      } else {
        // Multiple files - upload all
        await handleSubmitAnswer(fileArray)
      }
    } else {
      const errorMessage: Message = {
        id: Date.now().toString(),
        text: 'This question does not require a file upload. Please answer with text.',
        isUser: false,
        timestamp: getCurrentTime(),
        type: 'system',
      }
      setMessages((prev) => [...prev, errorMessage])
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleFileUploadClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click()
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    let value = e.target.value
    
    if (currentQuestion) {
      const field = currentQuestion.field.toLowerCase()
      const type = currentQuestion.type
      
      // Filter phone number input: only allow numbers and + sign (at start only)
      const isPhoneQuestion = 
        field.includes('phone') || 
        field.includes('mobile') || 
        field.includes('contact') || 
        currentQuestion.question.toLowerCase().includes('phone number')
      
      if (isPhoneQuestion) {
        // Allow + only at the start, then only digits
        if (value.startsWith('+')) {
          // After +, only digits allowed
          value = '+' + value.slice(1).replace(/[^0-9]/g, '')
        } else {
          // No +, only digits allowed
          value = value.replace(/[^0-9]/g, '')
        }
        
        // Limit to 13 digits (not counting +)
        const digitsOnly = value.replace(/\D/g, '')
        if (digitsOnly.length > 13) {
          value = value.slice(0, value.length - (digitsOnly.length - 13))
        }
      }
      
      // Filter pincode input: only allow numbers, max 6 digits
      const isPincodeQuestion = 
        field.includes('pincode') || 
        field.includes('pin') || 
        field.includes('postal') ||
        currentQuestion.question.toLowerCase().includes('pincode')
      
      if (isPincodeQuestion) {
        // Only allow digits
        value = value.replace(/[^0-9]/g, '')
        
        // Limit to 6 digits
        if (value.length > 6) {
          value = value.slice(0, 6)
        }
      }
      
      // Filter invoice number input: only allow numbers
      const isInvoiceNumberQuestion = 
        (field.includes('invoice') && field.includes('number')) ||
        currentQuestion.question.toLowerCase().includes('invoice number')
      
      if (isInvoiceNumberQuestion) {
        // Only allow digits
        value = value.replace(/[^0-9]/g, '')
        
        // Limit to 50 digits (reasonable limit for invoice numbers)
        if (value.length > 50) {
          value = value.slice(0, 50)
        }
      }
      
      // Filter warranty period input: only allow numbers, enforce 1-36 range
      const isWarrantyPeriodQuestion = 
        (field.includes('warranty') && field.includes('period')) ||
        currentQuestion.question.toLowerCase().includes('warranty period')
      
      if (isWarrantyPeriodQuestion) {
        // Only allow digits
        value = value.replace(/[^0-9]/g, '')
        
        // Limit to 2 digits (max 36)
        if (value.length > 2) {
          value = value.slice(0, 2)
        }
        
        // Enforce max value of 36
        const numValue = parseInt(value, 10)
        if (!isNaN(numValue) && numValue > 36) {
          value = '36'
        }
      }
      
      // Filter number input: only allow numbers, decimal point, negative sign, and scientific notation
      if (type === 'number') {
        // Allow: digits, one decimal point, negative sign at start, e/E for scientific notation
        value = value.replace(/[^0-9.\-eE]/g, '')
        
        // Ensure only one decimal point
        const parts = value.split('.')
        if (parts.length > 2) {
          value = parts[0] + '.' + parts.slice(1).join('')
        }
        
        // Ensure negative sign only at start
        if (value.includes('-')) {
          const hasNegativeAtStart = value.startsWith('-')
          value = (hasNegativeAtStart ? '-' : '') + value.replace(/-/g, '')
        }
        
        // Limit to reasonable length (e.g., 20 characters for very large numbers)
        if (value.length > 20) {
          value = value.slice(0, 20)
        }
      }
      
      // Enforce character limits for text and textarea
      if (type === 'text') {
        const maxLength = 500
        if (value.length > maxLength) {
          value = value.slice(0, maxLength)
        }
      }
      
      if (type === 'textarea') {
        const maxLength = 2000
        if (value.length > maxLength) {
          value = value.slice(0, maxLength)
        }
      }
      
      // General character limit for other text-based types
      if (type !== 'file' && type !== 'choice' && type !== 'select' && !['email', 'date'].includes(type) && !isPhoneQuestion) {
        const maxLength = 1000
        if (value.length > maxLength) {
          value = value.slice(0, maxLength)
        }
      }
    }
    
    setInput(value)
  }

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const startVoiceRecording = async () => {
    if (!currentQuestion || isLoading || isComplete) return
    try {
      const recorder = new VoiceRecorder({
        onError: () => {
          // Error is shown in catch below to avoid duplicate messages
        },
      })
      voiceRecorderRef.current = recorder
      await recorder.start()
      setIsRecording(true)
      setRecordingDuration(0)
      recordingIntervalRef.current = setInterval(() => {
        setRecordingDuration((d) => d + 1)
      }, 1000)
    } catch (err) {
      console.error('Voice recording start error:', err)
      const msg = err instanceof Error ? err.message : 'Unknown error'
      const hint =
        typeof window !== 'undefined' && !window.isSecureContext
          ? ' On mobile use HTTPS and allow microphone in site settings.'
          : ''
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          text: `Could not start recording: ${msg}.${hint}`,
          isUser: false,
          timestamp: getCurrentTime(),
          type: 'system',
        },
      ])
    }
  }

  const stopVoiceRecording = async () => {
    const recorder = voiceRecorderRef.current
    if (!recorder || !recorder.isRecording) return
    try {
      const blob = await recorder.stop()
      voiceRecorderRef.current = null
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current)
        recordingIntervalRef.current = null
      }
      setIsRecording(false)
      setRecordingDuration(0)
      await sendVoiceNoteWithBlob(blob)
    } catch (err) {
      console.error('Stop recording error:', err)
      voiceRecorderRef.current = null
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current)
        recordingIntervalRef.current = null
      }
      setIsRecording(false)
      setRecordingDuration(0)
    }
  }

  const cancelVoiceNote = () => {
    if (voiceRecorderRef.current?.isRecording) {
      voiceRecorderRef.current.stop().catch(() => {})
      voiceRecorderRef.current = null
    }
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current)
      recordingIntervalRef.current = null
    }
    setIsRecording(false)
    setRecordingDuration(0)
  }

  const sendVoiceNoteWithBlob = async (blob: Blob) => {
    if (!customerUuid || !currentQuestion) return
    const blobUrl = URL.createObjectURL(blob)
    const userMessage: Message = {
      id: Date.now().toString(),
      text: '🎤 Voice note',
      isUser: true,
      timestamp: getCurrentTime(),
      type: 'answer',
      voiceNoteBlobUrl: blobUrl,
    }
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)
    setIsUploading(true)
    setUploadingFiles([blob.type === 'audio/wav' ? 'voice-note.wav' : 'voice-note.webm'])
    try {
      const uploadResponse = await uploadVoiceNoteToS3(blob, customerUuid)
      const filePath = uploadResponse.file_path
      if (!filePath) throw new Error('No file_path from voice note upload')
      const response: SubmitAnswerResponse = await submitAnswer(
        customerUuid,
        currentQuestion.field,
        filePath,
        'file'
      )
      setCurrentPhase(response.current_phase)
      if (response.activation_details) {
        setIsComplete(true)
        const completionMessage: Message = {
          id: (Date.now() + 1).toString(),
          text: `✅ Activation completed successfully!\n\n📋 Activation Details:\n• Activation ID: ${response.activation_details.activation_id}\n• Sale ID: ${response.activation_details.sale_id}\n• Policy Serial: ${response.activation_details.policy_serial}\n• Plan: ${response.activation_details.plan_name}\n• Price: ₹${response.activation_details.customer_price}\n• Activation Date: ${response.activation_details.activation_date}\n• Expiry Date: ${response.activation_details.expiry_date}`,
          isUser: false,
          timestamp: getCurrentTime(),
          type: 'completion',
          activationDetails: response.activation_details,
        }
        setMessages((prev) => [...prev, completionMessage])
        setCurrentQuestion(null)
      } else if (response.next_question) {
        const phaseMsg = response.message
        if (phaseMsg && !phaseMsg.toLowerCase().includes('answer saved')) {
          setMessages((prev) => [
            ...prev,
            {
              id: (Date.now() + 1).toString(),
              text: phaseMsg,
              isUser: false,
              timestamp: getCurrentTime(),
              type: 'completion',
            },
          ])
        }
        const nextQuestion = response.next_question
        if (nextQuestion) {
          setCurrentQuestion(nextQuestion)
          setMessages((prev) => [
            ...prev,
            {
              id: (Date.now() + 2).toString(),
              text: nextQuestion.question,
              isUser: false,
              timestamp: getCurrentTime(),
              type: 'question',
              question: nextQuestion,
            },
          ])
          if (nextQuestion.type !== 'choice' && nextQuestion.type !== 'file') {
            setTimeout(() => {
              if (nextQuestion.type === 'date') dateInputRef.current?.focus()
              else textInputRef.current?.focus()
            }, 100)
          }
        } else {
          setIsComplete(true)
        }
      } else {
        setIsComplete(true)
      }
    } catch (error) {
      console.error('Voice note submit error:', error)
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          text: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Failed to send voice note'}. Please try again.`,
          isUser: false,
          timestamp: getCurrentTime(),
          type: 'system',
        },
      ])
    } finally {
      setIsLoading(false)
      setIsUploading(false)
      setUploadingFiles([])
    }
  }

  // Show error or loading state if not initialized
  if (!isMounted || !isInitialized) {
    return (
      <div className="flex flex-col h-screen bg-[#0B141A] items-center justify-center">
        {error ? (
          <div className="bg-[#202C33] rounded-lg px-6 py-4 max-w-md">
            <p className="text-white text-center">{error}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center space-y-4">
            <div className="flex space-x-1.5">
              <div
                className="w-2 h-2 bg-[#00A884] rounded-full animate-bounce"
                style={{ animationDelay: '0s' }}
              ></div>
              <div
                className="w-2 h-2 bg-[#00A884] rounded-full animate-bounce"
                style={{ animationDelay: '0.2s' }}
              ></div>
              <div
                className="w-2 h-2 bg-[#00A884] rounded-full animate-bounce"
                style={{ animationDelay: '0.4s' }}
              ></div>
            </div>
            <p className="text-[#8696A0] text-sm">Initializing activation...</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-[#0B141A]">
      {/* Header */}
      <div className="bg-[#202C33] text-white px-4 py-3 shadow-lg border-b border-[#2A3942]">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 overflow-hidden">
            <Image
              src="/logo-icon.png"
              alt="Logo"
              width={40}
              height={40}
              className="object-contain"
            />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-medium truncate">{CHATBOT_NAME}</h1>
            <p className="text-xs text-[#8696A0]">
              {isComplete ? 'Completed' : currentPhase ? `Phase: ${currentPhase.replace('_', ' ')}` : 'Online'}
            </p>
          </div>
        </div>
      </div>

      {/* Messages Container */}
      <div
        className="flex-1 overflow-y-auto px-4 py-6 bg-[#0B141A] relative"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23111B21' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      >
        {isMounted &&
          messages.map((message) => (
            <ChatMessage
              key={message.id}
              message={message.text}
              isUser={message.isUser}
              timestamp={message.timestamp}
              type={message.type}
              question={message.question}
              activationDetails={message.activationDetails}
              voiceNoteBlobUrl={message.voiceNoteBlobUrl}
              onChoiceSelect={handleChoiceSelect}
              isLoading={isLoading}
            />
          ))}
        {(isLoading || isUploading) && (
          <div className="flex justify-start mb-4">
            <div className="bg-[#202C33] rounded-lg rounded-tl-none px-4 py-2.5 shadow-lg max-w-[70%]">
              {isUploading && uploadingFiles.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex space-x-1.5">
                    <div
                      className="w-2 h-2 bg-[#8696A0] rounded-full animate-bounce"
                      style={{ animationDelay: '0s' }}
                    ></div>
                    <div
                      className="w-2 h-2 bg-[#8696A0] rounded-full animate-bounce"
                      style={{ animationDelay: '0.2s' }}
                    ></div>
                    <div
                      className="w-2 h-2 bg-[#8696A0] rounded-full animate-bounce"
                      style={{ animationDelay: '0.4s' }}
                    ></div>
                  </div>
                  <div className="text-xs text-[#8696A0] mt-2">
                    Uploading {uploadingFiles.length} file(s)...
                    {uploadingFiles.map((name, idx) => (
                      <div key={idx} className="text-[0.7rem]">• {name}</div>
                    ))}
                  </div>
                  {uploadProgress > 0 && (
                    <div className="w-full bg-[#2A3942] rounded-full h-1.5 mt-2">
                      <div
                        className="bg-[#00A884] h-1.5 rounded-full transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      ></div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex space-x-1.5">
                  <div
                    className="w-2 h-2 bg-[#8696A0] rounded-full animate-bounce"
                    style={{ animationDelay: '0s' }}
                  ></div>
                  <div
                    className="w-2 h-2 bg-[#8696A0] rounded-full animate-bounce"
                    style={{ animationDelay: '0.2s' }}
                  ></div>
                  <div
                    className="w-2 h-2 bg-[#8696A0] rounded-full animate-bounce"
                    style={{ animationDelay: '0.4s' }}
                  ></div>
                </div>
              )}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="bg-[#202C33] px-4 py-3 border-t border-[#2A3942]">
        {!isComplete && currentQuestion && (
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs text-[#8696A0]">
              Question {currentQuestion.question_number} of {currentQuestion.total_questions}
              {currentQuestion.type === 'file' && ' • File upload required'}
              {currentQuestion.type === 'choice' && ' • Select one of the options above'}
              {currentQuestion.type === 'date' && ' • Date format: YYYY-MM-DD'}
            </div>
          </div>
        )}
        {/* File Upload Button - Shows only when question type is 'file' */}
        {!isComplete && currentQuestion && currentQuestion.type === 'file' && (
          <div className="flex items-center justify-center py-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              onClick={handleFileUploadClick}
              disabled={isLoading || isUploading}
              className="bg-[#00A884] text-white rounded-lg px-6 py-3 font-medium hover:bg-[#06CF9C] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
              aria-label="Upload file(s)"
              title="Upload image(s) - Multiple files supported"
            >
              {isUploading ? (
                <>
                  <svg
                    className="animate-spin h-5 w-5"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  <span>Uploading...</span>
                </>
              ) : (
                <>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span>Upload Invoice Image</span>
                </>
              )}
            </button>
          </div>
        )}
        
        {/* Voice note recording bar - stop = send immediately */}
        {!isComplete && currentQuestion && isRecording && (
          <div className="flex items-center gap-3 py-2 px-3 bg-[#2A3942] rounded-lg">
            <div className="flex items-center gap-2 flex-1">
              <div className="flex items-end gap-0.5 h-5">
                {[4, 8, 6, 10, 5].map((h, i) => (
                  <div
                    key={i}
                    className="w-1 bg-[#00A884] rounded-full animate-pulse"
                    style={{ height: h, animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
              <span className="text-sm text-[#8696A0]">
                {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, '0')}
              </span>
            </div>
            <button
              type="button"
              onClick={cancelVoiceNote}
              className="text-[#8696A0] hover:text-white text-sm font-medium px-3 py-1.5 rounded"
              aria-label="Cancel recording"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={stopVoiceRecording}
              className="bg-[#00A884] text-white rounded-full p-2.5 hover:bg-[#06CF9C] transition-colors"
              aria-label="Stop and send"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        )}

        {/* Text/Number/Date input area - Hidden for choice and file questions */}
        {!isComplete && currentQuestion && currentQuestion.type !== 'choice' && currentQuestion.type !== 'file' && !isRecording && (
        <div className="flex items-start space-x-2">
          <div className="flex-1 relative">
            {currentQuestion?.type === 'date' ? (
              <input
                ref={dateInputRef}
                type="date"
                value={input}
                onChange={handleInputChange}
                placeholder="YYYY-MM-DD"
                className="w-full bg-[#2A3942] text-white placeholder-[#8696A0] rounded-lg px-4 py-2.5 focus:outline-none focus:ring-1 focus:ring-[#00A884] text-sm"
                disabled={isLoading || isComplete || !currentQuestion}
              />
            ) : (
              <textarea
                ref={textInputRef}
                value={input}
                onChange={handleInputChange}
                onKeyPress={handleKeyPress}
                placeholder={isComplete ? 'Activation completed' : currentQuestion ? `Type your answer...` : 'Waiting...'}
                className="w-full resize-none bg-[#2A3942] text-white placeholder-[#8696A0] rounded-lg px-4 py-2.5 pr-12 focus:outline-none focus:ring-1 focus:ring-[#00A884] max-h-32 min-h-11 text-sm"
                rows={1}
                disabled={isLoading || isComplete || !currentQuestion}
              />
            )}
          </div>
          {(() => {
            if (!currentQuestion) return null
            const field = currentQuestion.field.toLowerCase()
            const questionText = currentQuestion.question.toLowerCase()
            const isNumericInput =
              currentQuestion.type === 'number' ||
              currentQuestion.type === 'date' ||
              field.includes('gst') ||
              field.includes('percentage') ||
              field.includes('warranty') ||
              field.includes('period') ||
              questionText.includes('gst percentage') ||
              questionText.includes('percentage') ||
              questionText.includes('warranty period') ||
              questionText.includes('months')
            
            return (
              <button
                type="button"
                onClick={isRecording ? stopVoiceRecording : startVoiceRecording}
                disabled={isLoading || isComplete || isNumericInput}
                className="bg-[#2A3942] text-[#8696A0] hover:text-[#00A884] rounded-full p-3 hover:bg-[#344047] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
                aria-label={isRecording ? 'Stop recording' : 'Record voice note'}
                title={isNumericInput ? 'Voice note not available for this input type' : 'Record voice note'}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                </svg>
              </button>
            )
          })()}
          <button
            onClick={handleSend}
            disabled={isLoading || isComplete || !currentQuestion || !input.trim()}
            className="bg-[#00A884] text-white rounded-full p-3 hover:bg-[#06CF9C] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0 shadow-lg"
            aria-label="Send message"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        )}
      </div>
    </div>
  )
}
