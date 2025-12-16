import { useState, useCallback } from 'react'
import type { PortForwardConfig } from '@/types'

export function usePortForward() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startPortForward = useCallback(async (
    context: string,
    namespace: string,
    pod: string,
    localPort: number,
    remotePort: number
  ): Promise<{ pid: number; localPort: number }> => {
    if (!window.electronAPI) {
      throw new Error('Electron API가 사용할 수 없습니다')
    }

    setLoading(true)
    setError(null)

    try {
      const result = await window.electronAPI.startPortForward(
        context,
        namespace,
        pod,
        localPort,
        remotePort
      )

      if (!result.success || !result.pid || !result.localPort) {
        throw new Error(result.error || '포트포워딩 시작 실패')
      }

      return { pid: result.pid, localPort: result.localPort }
    } catch (err: any) {
      setError(err.message || '포트포워딩 시작 실패')
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const stopPortForward = useCallback(async (pid: number): Promise<void> => {
    if (!window.electronAPI) {
      throw new Error('Electron API가 사용할 수 없습니다')
    }

    setLoading(true)
    setError(null)

    try {
      const result = await window.electronAPI.stopPortForward(pid)

      if (!result.success) {
        throw new Error(result.error || '포트포워딩 중지 실패')
      }
    } catch (err: any) {
      setError(err.message || '포트포워딩 중지 실패')
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    loading,
    error,
    startPortForward,
    stopPortForward,
  }
}

