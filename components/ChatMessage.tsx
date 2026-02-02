'use client'

import { useState, useRef, useEffect } from 'react'
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
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const updateTime = () => setCurrentTime(audio.currentTime)
    const updateDuration = () => setDuration(audio.duration)
    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => setIsPlaying(false)
    const handleEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
    }

    audio.addEventListener('timeupdate', updateTime)
    audio.addEventListener('loadedmetadata', updateDuration)
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('ended', handleEnded)

    return () => {
      audio.removeEventListener('timeupdate', updateTime)
      audio.removeEventListener('loadedmetadata', updateDuration)
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('ended', handleEnded)
    }
  }, [voiceNoteBlobUrl])

  const togglePlayPause = () => {
    const audio = audioRef.current
    if (!audio) return

    if (isPlaying) {
      audio.pause()
    } else {
      audio.play()
    }
  }

  const formatTime = (seconds: number): string => {
    if (isNaN(seconds)) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
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
            <div className="flex items-center gap-2 bg-black/20 rounded-lg px-2 py-1.5 max-w-[240px]">
              {/* Play/Pause Button */}
              <button
                onClick={togglePlayPause}
                className="shrink-0 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4 text-white"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4 text-white ml-0.5"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                  </svg>
                )}
              </button>

              {/* Progress Bar */}
              <div className="flex-1 flex items-center gap-2">
                <div className="flex-1 h-1 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white/70 rounded-full transition-all duration-100"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="text-xs text-white/70 font-mono min-w-10 text-right">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
              </div>
            </div>
            <audio ref={audioRef} src={voiceNoteBlobUrl} preload="metadata" />
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
