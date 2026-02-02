'use client'

import type { Question, ActivationDetails } from '@/lib/kavach-api'

interface ChatMessageProps {
  message: string
  isUser: boolean
  timestamp?: string
  type?: 'question' | 'answer' | 'system' | 'completion'
  question?: Question
  activationDetails?: ActivationDetails
  /** Object URL for voice note playback (e.g. blob URL) */
  voiceNoteBlobUrl?: string
  onChoiceSelect?: (choice: string | number) => void
  isLoading?: boolean
}

export default function ChatMessage({
  message,
  isUser,
  timestamp,
  type,
  question,
  voiceNoteBlobUrl,
  onChoiceSelect,
  isLoading = false,
}: ChatMessageProps) {
  // Determine message styling based on type
  const getMessageStyles = () => {
    if (isUser) {
      return 'bg-[#005C4B] text-white rounded-lg rounded-tr-none'
    }
    if (type === 'system') {
      return 'bg-[#2A3942] text-[#8696A0] rounded-lg border border-[#2A3942]'
    }
    if (type === 'completion') {
      // Check if it's a phase transition message (highlighted)
      const isPhaseTransition = message.includes('completed') || message.includes('collecting') || message.includes('Now')
      if (isPhaseTransition) {
        return 'bg-[#00A884]/30 text-white rounded-lg border-2 border-[#00A884] font-semibold shadow-lg'
      }
      return 'bg-[#00A884]/20 text-white rounded-lg border border-[#00A884]/30'
    }
    return 'bg-[#202C33] text-white rounded-lg rounded-tl-none'
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-2 group`}>
      <div className={`max-w-[65%] sm:max-w-[70%] px-3 py-2 ${getMessageStyles()}`}>
        {voiceNoteBlobUrl ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm leading-relaxed mb-0.5">{message}</p>
            <audio
              src={voiceNoteBlobUrl}
              controls
              className="w-full max-w-[240px] h-9 accent-[#00A884]"
              preload="metadata"
            />
          </div>
        ) : (
          <p className="text-sm leading-relaxed whitespace-pre-wrap wrap-break-word mb-0.5">
            {message}
          </p>
        )}

        {/* Show choice buttons if question type is 'choice' */}
        {question && !isUser && question.type === 'choice' && question.choices && question.choices.length > 0 && (
          <div className="mt-3 pt-3 border-t border-white/10">
            <div className="flex flex-col gap-2">
              {question.choices.map((choice, index) => (
                <button
                  key={index}
                  onClick={() => onChoiceSelect?.(choice)}
                  disabled={isLoading}
                  className="w-full bg-[#2A3942] hover:bg-[#344047] text-white rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-[#2A3942] hover:border-[#00A884]/50 text-left"
                >
                  {String(choice)}
                </button>
              ))}
            </div>
          </div>
        )}

        {timestamp && (
          <div className="flex items-center justify-end mt-1">
            <span
              className={`text-[0.6875rem] lowercase ${
                isUser ? 'text-white/60' : 'text-white/50'
              }`}
            >
              {timestamp}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
