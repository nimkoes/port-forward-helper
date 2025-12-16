import { readFileSync, writeFileSync } from 'fs'
import hostile from 'hostile'

const HOSTS_START_MARKER = '# PORT_FORWARD_HELPER_START'
const HOSTS_END_MARKER = '# PORT_FORWARD_HELPER_END'

// macOS/Linux hosts 파일 경로
const getHostsPath = (): string => {
  if (process.platform === 'win32') {
    return 'C:\\Windows\\System32\\drivers\\etc\\hosts'
  }
  return '/etc/hosts'
}

export class HostsManager {
  private addedHosts: string[] = []

  constructor() {}

  /**
   * hosts 파일을 읽어서 마커 섹션을 제외한 내용을 반환합니다.
   */
  private readHostsFile(): { before: string[], after: string[], inSection: boolean } {
    const hostsPath = getHostsPath()
    let content: string
    
    try {
      // 일반 사용자 권한으로 읽기 시도
      content = readFileSync(hostsPath, 'utf-8')
    } catch (error: any) {
      if (error.code === 'EACCES') {
        // 권한 오류인 경우 sudo로 읽기
        const { execSync } = require('child_process')
        try {
          content = execSync(`sudo cat "${hostsPath}"`, { encoding: 'utf-8' })
        } catch (sudoError: any) {
          console.error('[Hosts Manager] Failed to read hosts file even with sudo:', sudoError)
          // 읽기 실패 시 빈 파일로 처리
          content = ''
        }
      } else {
        console.error('[Hosts Manager] Failed to read hosts file:', error)
        content = ''
      }
    }
    
    const lines = content.split('\n')
    
    const before: string[] = []
    const after: string[] = []
    let inSection = false
    let foundStart = false
    let foundEnd = false
    
    for (const line of lines) {
      if (line.trim() === HOSTS_START_MARKER) {
        foundStart = true
        inSection = true
        continue
      }
      if (line.trim() === HOSTS_END_MARKER) {
        foundEnd = true
        inSection = false
        continue
      }
      
      if (inSection) {
        // 섹션 내부의 기존 도메인은 무시 (새로 작성할 예정)
        continue
      }
      
      if (foundEnd) {
        after.push(line)
      } else {
        before.push(line)
      }
    }
    
    return { before, after, inSection: foundStart && foundEnd }
  }

  /**
   * 마커 섹션 외부의 기존 도메인 항목을 제거합니다.
   */
  private async removeOldDomainsFromSection(): Promise<void> {
    // 마커 섹션 외부에 있는 우리가 추가한 도메인들을 찾아서 제거
    for (const domain of this.addedHosts) {
      try {
        await new Promise<void>((resolve) => {
          hostile.remove('127.0.0.1', domain, (err: Error | null) => {
            if (err) {
              // 이미 제거되었거나 없는 경우는 무시
              console.log(`[Hosts Manager] Domain ${domain} not found or already removed`)
            }
            resolve()
          })
        })
      } catch (error) {
        // 무시
      }
    }
  }

  /**
   * 마커 섹션을 hosts 파일에 추가/업데이트합니다.
   */
  private async writeMarkerSection(domains: string[]): Promise<void> {
    const { before, after } = this.readHostsFile()
    const hostsPath = getHostsPath()
    
    // 새 hosts 파일 내용 생성
    const newLines: string[] = []
    
    // 시작 부분
    newLines.push(...before)
    
    // 마커 섹션 시작
    if (before.length > 0 && before[before.length - 1].trim() !== '') {
      newLines.push('')
    }
    newLines.push(HOSTS_START_MARKER)
    
    // 도메인 목록 추가
    for (const domain of domains) {
      newLines.push(`127.0.0.1\t${domain}`)
    }
    
    // 마커 섹션 종료
    newLines.push(HOSTS_END_MARKER)
    
    // 끝 부분
    if (after.length > 0 && after[0].trim() !== '') {
      newLines.push('')
    }
    newLines.push(...after)
    
    // 파일 작성 (sudo 권한 필요)
    const content = newLines.join('\n')
    const { exec } = require('child_process')
    const { promisify } = require('util')
    const execAsync = promisify(exec)
    
    try {
      // 임시 파일에 저장
      const tempFile = `/tmp/port-forward-helper-hosts-${Date.now()}`
      writeFileSync(tempFile, content, 'utf-8')
      
      // sudo로 복사하고 권한 설정 (644: owner read/write, others read)
      console.log(`[Hosts Manager] Executing: sudo cp "${tempFile}" "${hostsPath}" && sudo chmod 644 "${hostsPath}"`)
      const { stdout, stderr } = await execAsync(`sudo cp "${tempFile}" "${hostsPath}" && sudo chmod 644 "${hostsPath}" && rm "${tempFile}"`)
      if (stdout) console.log(`[Hosts Manager] stdout:`, stdout)
      if (stderr) console.log(`[Hosts Manager] stderr:`, stderr)
      console.log(`[Hosts Manager] Successfully wrote hosts file`)
    } catch (error: any) {
      console.error('[Hosts Manager] Failed to write hosts file:', error)
      console.error('[Hosts Manager] Error details:', {
        message: error.message,
        code: error.code,
        stdout: error.stdout,
        stderr: error.stderr
      })
      throw new Error(`Failed to write hosts file: ${error.message || error}`)
    }
  }

  /**
   * hosts 파일에 도메인을 추가합니다.
   */
  async addDomain(domain: string): Promise<void> {
    if (!this.addedHosts.includes(domain)) {
      await this.updateDomains([...this.addedHosts, domain])
    }
  }

  /**
   * hosts 파일에서 도메인을 제거합니다.
   */
  async removeDomain(domain: string): Promise<void> {
    if (this.addedHosts.includes(domain)) {
      await this.updateDomains(this.addedHosts.filter((d) => d !== domain))
    }
  }

  /**
   * hosts 파일의 도메인 목록을 업데이트합니다.
   */
  async updateDomains(domains: string[]): Promise<void> {
    try {
      console.log(`[Hosts Manager] Updating domains:`, domains)
      
      // 기존 도메인들을 마커 섹션 외부에서 제거 (혹시 있을 수 있음)
      await this.removeOldDomainsFromSection()
      
      // 마커 섹션에 도메인 목록 작성
      await this.writeMarkerSection(domains)
      
      // hostile을 사용하여 각 도메인을 추가 (이미 마커 섹션에 있지만, hostile이 관리하는 항목도 추가)
      // 하지만 실제로는 마커 섹션만 사용하므로 이 부분은 스킵
      
      this.addedHosts = [...domains]
      console.log(`[Hosts Manager] Successfully updated hosts file with ${domains.length} domains`)
    } catch (error) {
      console.error('[Hosts Manager] Failed to update domains:', error)
      throw error
    }
  }

  /**
   * 모든 추가된 hosts 항목을 정리합니다.
   */
  async cleanup(): Promise<void> {
    console.log('[Hosts Manager] Cleaning up hosts...')
    try {
      await this.updateDomains([])
    } catch (error) {
      console.error('[Hosts Manager] Error during cleanup:', error)
    }
  }

  /**
   * 현재 추가된 도메인 목록을 반환합니다.
   */
  getAddedHosts(): string[] {
    return [...this.addedHosts]
  }
}
