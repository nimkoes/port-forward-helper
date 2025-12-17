import React, { useEffect, useState } from 'react'
import './Notification.css'

interface NotificationProps {
  successCount: number
  failCount: number
  onClose: () => void
}

export const Notification: React.FC<NotificationProps> = ({
  successCount,
  failCount,
  onClose,
}) => {
  const [progress, setProgress] = useState(100)
  const duration = 5000 // 5초
  const interval = 50 // 50ms마다 업데이트

  useEffect(() => {
    const startTime = Date.now()
    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime
      const remaining = Math.max(0, duration - elapsed)
      const progressPercent = (remaining / duration) * 100
      setProgress(progressPercent)

      if (remaining <= 0) {
        clearInterval(timer)
        onClose()
      }
    }, interval)

    return () => clearInterval(timer)
  }, [onClose])

  return (
    <div className="notification">
      <div className="notification-progress-bar" style={{ width: `${progress}%` }}></div>
      <div className="notification-content">
        <div className="notification-header">
          <h4>Port Forward Results</h4>
          <button className="notification-close" onClick={onClose} title="Close">
            ×
          </button>
        </div>
        <div className="notification-body">
          <div className="notification-row">
            <span className="notification-label">success:</span>
            <span className="notification-value notification-success">{successCount}</span>
          </div>
          <div className="notification-row">
            <span className="notification-label">fail:</span>
            <span className="notification-value notification-fail">{failCount}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

