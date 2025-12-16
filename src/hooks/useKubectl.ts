import { useState, useCallback } from 'react'
import { getContexts, getNamespaces, getPods } from '@/utils/kubectl'
import type { KubernetesContext, Namespace, Pod } from '@/types'

export function useKubectl() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchContexts = useCallback(async (): Promise<KubernetesContext[]> => {
    setLoading(true)
    setError(null)
    try {
      const contexts = await getContexts()
      return contexts
    } catch (err: any) {
      setError(err.message || '컨텍스트 조회 실패')
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchNamespaces = useCallback(async (context: string): Promise<Namespace[]> => {
    setLoading(true)
    setError(null)
    try {
      const namespaces = await getNamespaces(context)
      return namespaces
    } catch (err: any) {
      setError(err.message || '네임스페이스 조회 실패')
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchPods = useCallback(async (context: string, namespace: string): Promise<Pod[]> => {
    // namespace 검증
    if (!namespace || namespace.trim() === '') {
      console.warn('[useKubectl] Empty namespace provided, returning empty array')
      return []
    }
    
    setLoading(true)
    setError(null)
    try {
      const pods = await getPods(context, namespace)
      return pods
    } catch (err: any) {
      setError(err.message || 'Pod 조회 실패')
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    loading,
    error,
    fetchContexts,
    fetchNamespaces,
    fetchPods,
  }
}

