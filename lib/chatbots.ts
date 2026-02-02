// ============================================
// CONFIGURATION FILE
// ============================================
// Update these values for your chatbot project
// This file is used for static site deployment

// Base API URL - update this later as needed
export const API_BASE_URL = 'https://cf1a7cdd45a6.ngrok-free.app'

// API endpoints for Kavach Activation
export const INITIATE_ACTIVATION_ENDPOINT = `${API_BASE_URL}/api/v1/partner/kavach-activation/initiate/`
export const SUBMIT_ANSWER_ENDPOINT = (customerUuid: string) =>  `${API_BASE_URL}/api/v1/partner/kavach-activation/${customerUuid}/submit-answer/`

// API endpoint for invoice upload (upload file first, then submit file_key)
export const INVOICE_UPLOAD_ENDPOINT = (customerUuid: string) => `${API_BASE_URL}/api/v1/partner/kavach-activation/${customerUuid}/upload-invoice/`

// API endpoint for lossless voice note upload (WAV) to S3
export const VOICE_NOTE_UPLOAD_ENDPOINT = (customerUuid: string) => `${API_BASE_URL}/api/v1/partner/kavach-activation/${customerUuid}/upload-voice-note/`

// Chatbot display name
export const CHATBOT_NAME = 'Chatbot'


