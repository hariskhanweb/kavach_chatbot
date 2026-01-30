'use client'

import { useState } from 'react'
import { INITIATE_ACTIVATION_ENDPOINT } from '@/lib/chatbots'
import type { InitiateResponse } from '@/lib/kavach-api'

interface AccessCodeModalProps {
  isOpen: boolean
  onSuccess: (response: InitiateResponse) => void
  onClose?: () => void
}

export default function AccessCodeModal({ isOpen, onSuccess }: AccessCodeModalProps) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    
    if (!email.trim()) {
      setError('Please enter your partner email')
      return
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email.trim())) {
      setError('Please enter a valid email address')
      return
    }

    setIsVerifying(true)
    
    try {
      const response = await fetch(INITIATE_ACTIVATION_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          partner_email: email.trim(),
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to initiate activation' }))
        const errorMessage = errorData.message || errorData.error || 'Failed to initiate activation. Please try again.'
        setError(errorMessage)
        setIsVerifying(false)
        return
      }

      const data: InitiateResponse = await response.json()

      // Check if the API response indicates success
      if (data.success === true && data.customer_uuid) {
        // Store email with customer_uuid for resume functionality
        localStorage.setItem('chatbot_partner_email', email.trim())
        
        // Success - pass the response to parent
        onSuccess(data)
        setIsVerifying(false)
        // Modal will close automatically when parent component updates state
      } else {
        // Failed - show error message
        setError('Failed to initiate activation. Please try again.')
        setIsVerifying(false)
      }
    } catch (error) {
      console.error('Error initiating activation:', error)
      setError('Failed to connect to server. Please check your connection and try again.')
      setIsVerifying(false)
    }
  }

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value)
    setError('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-[#202C33] rounded-lg shadow-2xl w-full max-w-md mx-4 p-6 border border-[#2A3942]">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-white">Access Required</h2>
        </div>

        <p className="text-[#8696A0] text-sm mb-4">
          Please enter your partner email to start the conversation.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-white mb-2">
              Partner Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={handleEmailChange}
              placeholder="Enter your partner email"
              className="w-full bg-[#2A3942] text-white placeholder-[#8696A0] rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#00A884] transition-all"
              disabled={isVerifying}
              autoFocus
            />
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-red-200 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isVerifying || !email.trim()}
            className="w-full bg-[#00A884] text-white rounded-lg px-4 py-3 font-medium hover:bg-[#06CF9C] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center space-x-2"
          >
            {isVerifying ? (
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
                <span>Verifying...</span>
              </>
            ) : (
              <span>Verify & Continue</span>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}

