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
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [recordingDuration, setRecordingDuration] = useState(0)
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

    // Email validation
    if (type === 'email' || field.includes('email')) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(answer.trim())) {
        return 'Please enter a valid email address (e.g., example@domain.com)'
      }
    }

    // Phone validation
    if (field.includes('phone') || field.includes('mobile') || field.includes('contact')) {
      const digitsOnly = answer.replace(/\D/g, '')
      if (digitsOnly.length < 10 || digitsOnly.length > 15) {
        return 'Please enter a valid phone number (10-15 digits)'
      }
    }

    // Pincode validation
    if (field.includes('pincode') || field.includes('pin') || field.includes('postal')) {
      const pincodeRegex = /^\d{6}$/
      if (!pincodeRegex.test(answer.trim())) {
        return 'Please enter a valid 6-digit pincode'
      }
    }

    // Number validation
    if (type === 'number') {
      if (isNaN(Number(answer.trim()))) {
        return 'Please enter a valid number'
      }
    }

    // Date validation (for text input dates)
    if (type === 'date') {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/
      if (!dateRegex.test(answer.trim())) {
        return 'Please enter a valid date in YYYY-MM-DD format'
      }
      const date = new Date(answer.trim())
      if (isNaN(date.getTime())) {
        return 'Please enter a valid date'
      }
    }

    // Required field validation
    if (question.required && !answer.trim()) {
      return 'This field is required'
    }

    return null
  }


  // Initialize activation on mount using partner_id from URL
  // FOR TESTING: skip initiate API and use mock data so UI loads. Re-enable when testing is done.
  const SKIP_INITIATE_FOR_TESTING = true
  useEffect(() => {
    setIsMounted(true)
    if (isInitialized) return

    const initializeActivation = async () => {
      setIsLoading(true)
      setError(null)

      if (SKIP_INITIATE_FOR_TESTING) {
        // Bypass API: use mock data so chat UI loads for testing
        const mockCustomerUuid = 'test-customer-uuid'
        const mockQuestion: Question = {
          field: 'test_field',
          question: 'What is your email? (testing mode – submit will call real API)',
          type: 'email',
          required: true,
          question_number: 1,
          total_questions: 1,
          choices: undefined,
        }
        setCustomerUuid(mockCustomerUuid)
        setCurrentPhase('test')
        setCurrentQuestion(mockQuestion)
        localStorage.setItem('chatbot_customer_uuid', mockCustomerUuid)
        setIsInitialized(true)
        setMessages([
          {
            id: '1',
            text: mockQuestion.question,
            isUser: false,
            timestamp: getCurrentTime(),
            type: 'question',
            question: mockQuestion,
          },
        ])
        setTimeout(() => textInputRef.current?.focus(), 100)
        setIsLoading(false)
        return
      }

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
      setRecordedBlob(null)
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
      setRecordedBlob(blob)
      setRecordingDuration(0)
    } catch (err) {
      console.error('Stop recording error:', err)
      voiceRecorderRef.current = null
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current)
        recordingIntervalRef.current = null
      }
      setIsRecording(false)
      setRecordedBlob(null)
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
    setRecordedBlob(null)
    setRecordingDuration(0)
  }

  const sendVoiceNote = async () => {
    if (!recordedBlob || !customerUuid || !currentQuestion) return
    const blob = recordedBlob
    setRecordedBlob(null)
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
      const fileKey = uploadResponse.file_key
      if (!fileKey) throw new Error('No file_key from voice note upload')
      const response: SubmitAnswerResponse = await submitAnswer(
        customerUuid,
        currentQuestion.field,
        fileKey,
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
        
        {/* Voice note recording bar - WhatsApp style */}
        {!isComplete && currentQuestion && (isRecording || recordedBlob) && (
          <div className="flex items-center gap-3 py-2 px-3 bg-[#2A3942] rounded-lg">
            {isRecording ? (
              <>
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
                  onClick={stopVoiceRecording}
                  className="bg-[#00A884] text-white rounded-full p-2.5 hover:bg-[#06CF9C] transition-colors"
                  aria-label="Stop recording"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5 5v10h10V5H5zM3 3a2 2 0 012-2h10a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V3z" clipRule="evenodd" />
                  </svg>
                </button>
              </>
            ) : recordedBlob ? (
              <>
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-[#00A884]">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                    </svg>
                  </span>
                  <span className="text-sm text-white">Voice note ready</span>
                </div>
                <button
                  type="button"
                  onClick={cancelVoiceNote}
                  className="text-[#8696A0] hover:text-white text-sm font-medium px-3 py-1.5 rounded"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={sendVoiceNote}
                  disabled={isLoading}
                  className="bg-[#00A884] text-white rounded-full p-2.5 hover:bg-[#06CF9C] disabled:opacity-50 transition-colors"
                  aria-label="Send voice note"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                  </svg>
                </button>
              </>
            ) : null}
          </div>
        )}

        {/* Text/Number/Date input area - Hidden for choice and file questions */}
        {!isComplete && currentQuestion && currentQuestion.type !== 'choice' && currentQuestion.type !== 'file' && !isRecording && !recordedBlob && (
        <div className="flex items-start space-x-2">
          <div className="flex-1 relative">
            {currentQuestion?.type === 'date' ? (
              <input
                ref={dateInputRef}
                type="date"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="YYYY-MM-DD"
                className="w-full bg-[#2A3942] text-white placeholder-[#8696A0] rounded-lg px-4 py-2.5 focus:outline-none focus:ring-1 focus:ring-[#00A884] text-sm"
                disabled={isLoading || isComplete || !currentQuestion}
              />
            ) : (
              <textarea
                ref={textInputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={isComplete ? 'Activation completed' : currentQuestion ? `Type your answer...` : 'Waiting...'}
                className="w-full resize-none bg-[#2A3942] text-white placeholder-[#8696A0] rounded-lg px-4 py-2.5 pr-12 focus:outline-none focus:ring-1 focus:ring-[#00A884] max-h-32 min-h-11 text-sm"
                rows={1}
                disabled={isLoading || isComplete || !currentQuestion}
              />
            )}
          </div>
          <button
            type="button"
            onClick={isRecording ? stopVoiceRecording : startVoiceRecording}
            disabled={isLoading || isComplete || !currentQuestion}
            className="bg-[#2A3942] text-[#8696A0] hover:text-[#00A884] rounded-full p-3 hover:bg-[#344047] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
            aria-label={isRecording ? 'Stop recording' : 'Record voice note'}
            title="Record voice note"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
            </svg>
          </button>
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
              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
            </svg>
          </button>
        </div>
        )}
      </div>
    </div>
  )
}
