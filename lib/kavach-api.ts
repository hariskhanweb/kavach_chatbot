// API utility functions for Kavach Activation flow

import {
  INITIATE_ACTIVATION_ENDPOINT,
  SUBMIT_ANSWER_ENDPOINT,
  INVOICE_UPLOAD_ENDPOINT,
  VOICE_NOTE_UPLOAD_ENDPOINT,
} from './chatbots'

export interface Question {
  field: string
  question: string
  type: 'text' | 'number' | 'email' | 'file' | 'select' | 'textarea' | 'choice' | 'date'
  required: boolean
  question_number: number
  total_questions: number
  choices?: (string | number)[]
}

export interface InitiateResponse {
  success: boolean
  customer_uuid: string
  partner_id: string
  partner_email: string
  current_phase: string
  question: Question
}

export interface SubmitAnswerResponse {
  success: boolean
  current_phase: string
  message?: string
  next_question?: Question
  activation_details?: ActivationDetails
}

export interface ActivationDetails {
  activation_id: string
  sale_id: string
  policy_serial: string
  plan_name: string
  customer_price: number
  activation_date: string
  expiry_date: string
  qr_url: string
}

export interface InvoiceUploadResponse {
  success: boolean
  file_key?: string
  file_keys?: string[]
  bucket?: string
  message?: string
}

export interface VoiceNoteUploadResponse {
  success: boolean
  file_key?: string
  bucket?: string
  message?: string
}

/**
 * Upload voice note (WAV or webm/opus from MediaRecorder) to S3.
 * POST /api/v1/partner/kavach-activation/{customer_uuid}/upload-voice-note/
 * Request: form field "file" (audio/wav or audio/webm).
 * Response: success, file_key, bucket, message.
 */
export async function uploadVoiceNoteToS3(
  audioBlob: Blob,
  customerUuid: string
): Promise<VoiceNoteUploadResponse> {
  const endpoint = VOICE_NOTE_UPLOAD_ENDPOINT(customerUuid)
  const formData = new FormData()
  const isWav = audioBlob.type === 'audio/wav'
  const filename = isWav ? 'voice-note.wav' : 'voice-note.webm'
  const file = new File([audioBlob], filename, { type: audioBlob.type || 'audio/webm' })
  formData.append('file', file)

  const response = await fetch(endpoint, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to upload voice note' }))
    throw new Error(error.error || error.message || 'Failed to upload voice note')
  }

  const data = await response.json()
  if (!data.file_key) {
    throw new Error('Invalid response from voice note upload: missing file_key')
  }
  return {
    success: data.success !== undefined ? data.success : true,
    file_key: data.file_key,
    bucket: data.bucket,
    message: data.message,
  }
}

/**
 * Initiate activation flow
 */
export async function initiateActivation(partnerId: string): Promise<InitiateResponse> {
  const response = await fetch(INITIATE_ACTIVATION_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      partner_id: partnerId,
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to initiate activation' }))
    throw new Error(error.error || error.message || 'Failed to initiate activation')
  }

  return response.json()
}

/**
 * Upload invoice file(s) to S3 using Kavach invoice upload endpoint
 * POST /api/v1/partner/kavach-activation/{customer_uuid}/upload-invoice/
 *
 * Request format (per API spec):
 * - Single file: form field "file"
 * - Multiple files: form field "files" repeated (recommended)
 *
 * Response: success, file_keys (array), bucket, count, message
 */
export async function uploadFileToS3Direct(
  fileOrFiles: File | File[],
  customerUuid: string
): Promise<InvoiceUploadResponse> {
  const endpoint = INVOICE_UPLOAD_ENDPOINT(customerUuid)
  const formData = new FormData()
  const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles]

  if (files.length === 0) {
    throw new Error('No files provided. You can upload files using: (1) \'files\' field for multiple files, or (2) \'file\' field for single file.')
  }

  if (files.length === 1) {
    formData.append('file', files[0])
  } else {
    for (const file of files) {
      formData.append('files', file)
    }
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to upload file' }))
    throw new Error(error.error || error.message || 'Failed to upload file')
  }

  const data = await response.json()

  const hasFileKey = data.file_key != null && data.file_key !== ''
  const hasFileKeys = Array.isArray(data.file_keys) && data.file_keys.length > 0

  if (!hasFileKey && !hasFileKeys) {
    throw new Error('Invalid response from S3 upload: missing file_key or file_keys')
  }

  return {
    success: data.success !== undefined ? data.success : true,
    file_key: data.file_key,
    file_keys: data.file_keys,
    bucket: data.bucket,
    message: data.message,
  }
}


/**
 * Submit an answer to a question
 * For file uploads: Uploads file to S3 first (invoice-db-start), then submits file_key as answer
 * Backend validates file exists in S3 before accepting the answer
 */
export async function submitAnswer(
  customerUuid: string,
  field: string,
  answer: string | File | File[],
  questionType?: string
): Promise<SubmitAnswerResponse> {
  const endpoint = SUBMIT_ANSWER_ENDPOINT(customerUuid)

  // Handle voice note: answer is already-uploaded file_key (from uploadVoiceNoteToS3)
  if (questionType === 'file' && typeof answer === 'string') {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field, answer: [answer] }),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to submit answer' }))
      throw new Error(error.error || error.message || 'Failed to submit answer')
    }
    return response.json()
  }

  // Handle file upload - upload to S3 first (single or multiple), then submit file_key(s)
  if ((answer instanceof File || Array.isArray(answer)) && questionType === 'file') {
    try {
      const files: File[] = answer instanceof File ? [answer] : answer
      if (files.length === 0) {
        throw new Error('No file(s) to upload')
      }

      // Step 1: Upload file(s) using Kavach invoice upload endpoint (supports multiple)
      const uploadResponse = await uploadFileToS3Direct(files, customerUuid)

      // Step 2: Build answer - backend expects array of file_keys for submit-answer (invoice_images)
      const fileKeysArray: string[] =
        uploadResponse.file_keys && uploadResponse.file_keys.length > 0
          ? uploadResponse.file_keys
          : uploadResponse.file_key
            ? [uploadResponse.file_key]
            : []

      if (fileKeysArray.length === 0) {
        throw new Error('Invalid response from S3 upload: missing file_key or file_keys')
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          field,
          answer: fileKeysArray,
        }),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to submit answer' }))
        throw new Error(error.error || error.message || 'Failed to submit answer')
      }

      return response.json()
    } catch (error) {
      console.error('File upload error:', error)
      throw error
    }
  }

  // Handle text answer (sent as JSON)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      field,
      answer,
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to submit answer' }))
    throw new Error(error.error || error.message || 'Failed to submit answer')
  }

  return response.json()
}


