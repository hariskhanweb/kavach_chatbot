import { Suspense } from 'react'
import ChatInterface from '@/components/ChatInterface'

export default function Home() {
  return (
    <main className="h-screen">
      <Suspense fallback={
        <div className="h-screen flex items-center justify-center bg-[#0B141A]">
          <div className="text-white">Loading...</div>
        </div>
      }>
        <ChatInterface />
      </Suspense>
    </main>
  )
}
