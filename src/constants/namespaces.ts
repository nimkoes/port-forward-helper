/**
 * 제외할 namespace 목록 (시스템 + 사용자 지정)
 * 이 목록에 포함된 namespace는 Pod, Service 조회 시 제외됩니다.
 */
export const EXCLUDED_NAMESPACES = [
  // 시스템 namespace
  'kube-system',
  'kube-public',
  'kube-node-lease',
  // 사용자 지정 제외 namespace
  'default',
  'argocd',
  'azp',
  'calico-system',
  'gateway',
  'migx',
  'projectcontour',
  'submarine',
  'submarine-acct',
  'test-ui',
  'tigera-operator',
  'opentelemetry-operator-system',
] as const

