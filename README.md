# Kubernetes Port Forward Helper

Kubernetes 클러스터의 여러 컨텍스트에서 Pod 포트포워딩을 시각적으로 관리할 수 있는 Electron 데스크톱 애플리케이션입니다.

## 개요

이 애플리케이션은 여러 Kubernetes 클러스터 컨텍스트를 관리하고, 각 컨텍스트의 네임스페이스와 Pod에 대한 포트포워딩을 쉽게 설정하고 해제할 수 있도록 도와줍니다. kubectl 명령어를 직접 입력할 필요 없이 GUI를 통해 포트포워딩을 관리할 수 있습니다.

## 주요 기능

- **다중 컨텍스트 관리**: 여러 Kubernetes 클러스터 컨텍스트를 탭으로 구분하여 관리
- **스마트 네임스페이스 필터링**: 
  - 허용된 네임스페이스만 표시 (`.env` 파일에서 설정 가능)
  - 기본적으로 모든 네임스페이스가 비활성화 상태로 시작
  - 편의 버튼: 전체 선택, 전부 해제, Only (특정 네임스페이스만 보기)
- **지연 로딩 및 병렬 처리**: 선택한 네임스페이스의 Pod만 로드하며, 여러 네임스페이스 선택 시 동시에 로드하여 빠른 성능 제공
- **Pod 포트 정보 표시**: 각 Pod의 컨테이너 포트 정보를 자동으로 조회하여 표시
  - FAILED 상태 Pod 자동 필터링
  - 포트가 없는 Pod 자동 필터링
- **직관적인 포트포워딩 관리**: 
  - 각 Pod의 포트별로 로컬 포트를 지정
  - 색상으로 상태 구분 (활성: 초록색, 비활성: 회색)
  - 전체 행 클릭으로 포트포워딩 토글
- **실시간 상태 업데이트**: Refresh 버튼으로 최신 Pod 및 네임스페이스 정보 조회 (선택한 네임스페이스 유지)
- **로딩 상태 표시**: 로딩 스피너 애니메이션으로 진행 상태를 시각적으로 표시

## 시스템 요구사항

- **Node.js**: 18.0.0 이상
- **kubectl**: Kubernetes CLI 도구가 시스템에 설치되어 있어야 하며, PATH에 등록되어 있어야 합니다
- **운영체제**: macOS, Windows, Linux (Electron이 지원하는 모든 플랫폼)

## 설치 방법

1. 저장소를 클론하거나 다운로드합니다:
```bash
git clone <repository-url>
cd port-forward-helper
```

2. 의존성을 설치합니다:
```bash
npm install
```

3. 환경 변수 설정 파일을 생성합니다:
```bash
cp .env.example .env
```

4. `.env` 파일을 열어서 허용할 네임스페이스를 설정합니다:
```bash
# 텍스트 에디터로 .env 파일 열기
nano .env
# 또는
code .env
```

`.env` 파일에서 `VITE_ALLOWED_NAMESPACES` 변수를 수정하여 사용할 네임스페이스를 쉼표로 구분하여 나열합니다:
```
VITE_ALLOWED_NAMESPACES=app,api,backend,frontend,database,cache,monitoring,logging
```

## 설정

### 환경 변수 설정

애플리케이션은 `.env` 파일을 통해 허용된 네임스페이스 목록을 설정합니다.

#### .env 파일 생성

프로젝트 루트 디렉토리에 `.env` 파일을 생성하거나, `.env.example` 파일을 복사하여 사용할 수 있습니다:

```bash
cp .env.example .env
```

#### 환경 변수 설정

`.env` 파일에 다음 형식으로 허용할 네임스페이스를 설정합니다:

```
VITE_ALLOWED_NAMESPACES=app,api,backend,frontend,database,cache,monitoring,logging,testing,staging,production,dev,qa,tools,infra,security,analytics,messaging,storage
```

- 네임스페이스는 쉼표(`,`)로 구분합니다
- 공백은 자동으로 제거됩니다
- 환경 변수가 설정되지 않은 경우, 네임스페이스 목록이 비어있게 됩니다

#### 설정 변경 적용

환경 변수를 변경한 후에는 애플리케이션을 재시작해야 변경사항이 적용됩니다:

```bash
# 개발 모드 재시작
npm run dev
```

#### .env.example 파일

프로젝트에는 `.env.example` 파일이 포함되어 있으며, 이 파일은 예시 설정을 제공합니다. 실제 사용을 위해서는 `.env` 파일을 생성하고 필요한 네임스페이스 목록을 설정하세요.

**주의**: `.env` 파일은 Git에 커밋되지 않습니다 (`.gitignore`에 포함). 각 개발 환경에 맞게 별도로 설정해야 합니다.

## 실행 방법

### 사전 준비

애플리케이션을 실행하기 전에 다음을 확인하세요:

1. **kubectl 설치 확인**:
```bash
kubectl version --client
```

2. **kubectl 컨텍스트 확인**:
```bash
kubectl config get-contexts
```

최소 하나 이상의 컨텍스트가 있어야 합니다.

### 개발 모드

개발 모드로 실행하면 Hot Module Replacement(HMR)가 활성화되어 코드 변경 시 자동으로 반영됩니다:

```bash
npm run dev
```

실행 시:
1. Electron 메인 프로세스와 preload 스크립트가 빌드됩니다 (`out/main/`, `out/preload/`)
2. Vite 개발 서버가 시작됩니다 (http://localhost:5173)
3. Electron 창이 자동으로 열립니다

**주의**: 개발 모드에서는 `out/` 디렉토리에 빌드된 파일이 생성됩니다. 이 디렉토리는 `.gitignore`에 포함되어 있습니다.

### 프로덕션 빌드

배포용 애플리케이션을 빌드하려면:

```bash
npm run build
```

빌드가 완료되면 다음 디렉토리에 빌드된 파일들이 생성됩니다:
- `dist-electron/`: Electron 메인 프로세스 및 preload 스크립트
- `dist/`: React 렌더러 프로세스 (HTML, CSS, JS 번들)

### 프로덕션 빌드 실행

빌드된 애플리케이션을 실행하려면:

```bash
npm run preview
```

또는 직접 Electron을 실행:

```bash
npx electron dist-electron/main.js
```

**참고**: 프로덕션 빌드에서는 `dist-electron/` 디렉토리의 파일을 사용합니다.

## 사용 방법

### 1. 애플리케이션 시작

애플리케이션을 실행하면 자동으로 `kubectl config get-contexts` 명령어를 실행하여 사용 가능한 모든 Kubernetes 컨텍스트를 조회합니다.

### 2. 컨텍스트 선택

상단의 탭에서 작업할 Kubernetes 컨텍스트를 선택합니다. 현재 활성화된 컨텍스트는 "현재" 배지가 표시됩니다.

### 3. 네임스페이스 관리

왼쪽 사이드바에서 네임스페이스 목록을 확인할 수 있습니다:
- **허용된 네임스페이스만 표시**: `.env` 파일에 설정된 허용된 네임스페이스만 목록에 표시됩니다
- **기본 상태**: 기본적으로 모든 네임스페이스가 비활성화 상태로 시작합니다
- **네임스페이스 선택/해제**: 네임스페이스 버튼을 클릭하여 해당 네임스페이스의 Pod 목록을 보이거나 숨길 수 있습니다. 선택하면 해당 네임스페이스의 Pod가 자동으로 로드됩니다
- **편의 버튼**:
  - **전체**: 허용된 모든 네임스페이스를 선택합니다 (병렬로 Pod 로드)
  - **해제**: 모든 네임스페이스를 해제합니다
  - **Only**: 특정 네임스페이스 옆의 "Only" 버튼을 클릭하면 해당 네임스페이스만 선택됩니다

**성능 최적화**: 선택한 네임스페이스의 Pod만 로드되므로 불필요한 데이터를 로드하지 않아 빠른 성능을 제공합니다. 여러 네임스페이스를 선택하면 병렬로 로드되어 더욱 빠르게 처리됩니다.

### 4. Pod 포트포워딩 설정

메인 영역에서 각 Pod의 포트 정보를 확인하고 포트포워딩을 설정할 수 있습니다:

1. **Pod 필터링**: FAILED 상태이거나 포트가 없는 Pod는 자동으로 필터링되어 표시되지 않습니다
2. **포트 정보 확인**: 각 Pod 아래에 컨테이너 포트 번호, 포트 이름(있는 경우), 프로토콜이 표시됩니다
3. **로컬 포트 입력**: "로컬 포트" 입력 필드에 외부에서 접근할 포트 번호를 입력합니다 (기본값은 컨테이너 포트 번호). 입력 필드를 클릭하면 행 전체가 토글되지 않습니다
4. **포트포워딩 활성화/비활성화**: 
   - 포트포워딩 행을 클릭하면 포트포워딩이 토글됩니다
   - 활성 상태: 초록색 테두리와 배경으로 표시됩니다
   - 비활성 상태: 회색 테두리로 표시됩니다

### 5. 새로고침

각 컨텍스트 탭 옆의 새로고침 버튼(↻)을 클릭하면 해당 컨텍스트의 네임스페이스 및 Pod 정보를 최신 상태로 업데이트합니다. **중요**: 새로고침 시 선택한 네임스페이스는 유지되며, 해당 네임스페이스의 Pod 정보만 갱신됩니다.

## 기술 스택

- **Electron**: 크로스 플랫폼 데스크톱 애플리케이션 프레임워크
- **React**: UI 라이브러리
- **TypeScript**: 타입 안정성을 위한 프로그래밍 언어
- **Vite**: 빠른 빌드 도구 및 개발 서버
- **electron-vite**: Electron과 Vite를 통합하는 빌드 도구

## 프로젝트 구조

```
port-forward-helper/
├── electron/              # Electron 메인 프로세스
│   ├── main.ts           # 메인 프로세스 진입점 및 IPC 핸들러
│   └── preload.ts        # Preload 스크립트 (보안 브릿지)
├── src/                  # React 애플리케이션 소스
│   ├── renderer/         # 렌더러 프로세스 진입점
│   │   ├── index.html    # HTML 템플릿
│   │   └── main.tsx      # React 진입점
│   ├── components/       # React 컴포넌트
│   │   ├── ContextTabs.tsx
│   │   ├── ContextTabs.css
│   │   ├── NamespaceList.tsx
│   │   ├── NamespaceList.css
│   │   ├── PodList.tsx
│   │   ├── PodList.css
│   │   ├── PortForwardingRow.tsx
│   │   └── PortForwardingRow.css
│   ├── hooks/            # React 커스텀 훅
│   │   ├── useKubectl.ts
│   │   └── usePortForward.ts
│   ├── types/            # TypeScript 타입 정의
│   │   ├── index.ts
│   │   └── electron.d.ts
│   ├── utils/            # 유틸리티 함수
│   │   └── kubectl.ts
│   ├── App.tsx           # 메인 앱 컴포넌트
│   └── App.css           # 전역 스타일
├── out/                  # 개발 모드 빌드 출력 (gitignore)
│   ├── main/
│   ├── preload/
│   └── renderer/
├── dist/                 # 프로덕션 빌드 출력 (gitignore)
├── dist-electron/        # 프로덕션 Electron 빌드 출력 (gitignore)
├── package.json
├── tsconfig.json
├── electron.vite.config.ts
└── README.md
```

## 작동 원리

### kubectl 명령어 실행

애플리케이션은 Electron의 메인 프로세스에서 `child_process`를 사용하여 kubectl 명령어를 실행합니다. 보안을 위해 렌더러 프로세스(React)에서는 직접 시스템 명령어를 실행할 수 없으며, IPC(Inter-Process Communication)를 통해 메인 프로세스에 요청을 보냅니다.

### 포트포워딩 프로세스 관리

포트포워딩은 `kubectl port-forward` 명령어를 백그라운드 프로세스로 실행하여 관리합니다. 각 포트포워딩 프로세스의 PID를 추적하여 필요 시 종료할 수 있습니다. 애플리케이션이 종료될 때 모든 포트포워딩 프로세스도 자동으로 종료됩니다.

### 지연 로딩 및 병렬 처리

애플리케이션은 성능 최적화를 위해 지연 로딩(Lazy Loading)과 병렬 처리를 사용합니다:

- **지연 로딩**: 컨텍스트 변경 시 네임스페이스 목록만 로드하고, Pod는 선택한 네임스페이스에 대해서만 로드합니다. 이를 통해 불필요한 데이터 로드를 방지하고 초기 로딩 시간을 단축합니다.

- **병렬 처리**: 여러 네임스페이스를 선택하면 `Promise.all`을 사용하여 모든 네임스페이스의 Pod를 동시에 로드합니다. 순차적으로 로드하는 것보다 훨씬 빠르게 처리됩니다.

- **메모리 최적화**: 네임스페이스를 해제하면 해당 네임스페이스의 Pod 데이터도 메모리에서 제거하여 리소스를 절약합니다.

**성능 비교**:
- 이전 방식: 모든 네임스페이스의 Pod를 순차적으로 로드 (18개 × 평균 2초 ≈ 36초)
- 최적화 후: 선택한 네임스페이스만 병렬 로드 (최대 2-3초, 가장 느린 네임스페이스 기준)

### 상태 관리

React의 useState와 useMemo를 사용하여 애플리케이션 상태를 관리합니다:
- 컨텍스트 목록 및 활성 컨텍스트
- 네임스페이스 목록 및 표시/숨김 상태
- Pod 목록 (네임스페이스별로 그룹화, 지연 로딩)
- 포트포워딩 설정 (컨텍스트, 네임스페이스, Pod별로 계층화)

## 문제 해결

### 애플리케이션이 시작되지 않습니다

**오류: "No electron app entry file found"**

이 오류는 보통 빌드 파일이 없거나 잘못된 경로를 참조할 때 발생합니다:

1. 빌드 디렉토리 삭제 후 재빌드:
```bash
rm -rf out dist-electron dist
npm run dev
```

2. `package.json`의 `main` 필드가 올바른지 확인:
```json
"main": "out/main/index.js"
```

3. `electron.vite.config.ts`의 설정이 올바른지 확인

**오류: "build.rollupOptions.input option is required"**

이 오류는 renderer 설정에 input이 없을 때 발생합니다. `src/renderer/index.html` 파일이 존재하는지 확인하세요.

### kubectl을 찾을 수 없습니다

kubectl이 시스템에 설치되어 있고 PATH에 등록되어 있는지 확인하세요:

```bash
which kubectl
kubectl version --client
```

kubectl이 설치되어 있지 않다면:
- macOS: `brew install kubectl`
- Linux: 공식 문서 참조
- Windows: 공식 문서 참조

### 컨텍스트를 조회할 수 없습니다

kubectl 설정 파일이 올바른 위치에 있는지 확인하세요:
- macOS/Linux: `~/.kube/config`
- Windows: `%USERPROFILE%\.kube\config`

또한 kubectl이 올바르게 설정되어 있는지 확인:
```bash
kubectl config get-contexts
```

컨텍스트가 하나도 없다면:
```bash
kubectl config set-context <context-name> --cluster=<cluster-name> --user=<user-name>
```

### 네임스페이스나 Pod가 표시되지 않습니다

1. 선택한 컨텍스트에 접근 권한이 있는지 확인:
```bash
kubectl --context <context-name> get namespaces
```

2. 네트워크 연결 상태 확인

3. Refresh 버튼을 클릭하여 다시 로드

4. 개발자 도구의 콘솔에서 에러 메시지 확인 (F12 또는 Cmd+Option+I)

### 포트포워딩이 시작되지 않습니다

1. **Pod가 실행 중인지 확인**:
```bash
kubectl --context <context-name> get pods -n <namespace>
```

2. **로컬 포트가 이미 사용 중인지 확인**:
```bash
# macOS/Linux
lsof -i :<port-number>

# Windows
netstat -ano | findstr :<port-number>
```

3. **네트워크 연결 상태 확인**

4. **kubectl이 해당 컨텍스트에 접근할 수 있는 권한이 있는지 확인**:
```bash
kubectl --context <context-name> auth can-i get pods -n <namespace>
```

5. **터미널에서 직접 포트포워딩 테스트**:
```bash
kubectl --context <context-name> port-forward -n <namespace> pod/<pod-name> <local-port>:<remote-port>
```

### 포트포워딩이 예상대로 작동하지 않습니다

1. **포트포워딩 프로세스 확인**:
애플리케이션을 종료하지 않고 개발자 도구 콘솔에서 확인하거나, 터미널에서:
```bash
ps aux | grep "kubectl port-forward"
```

2. **포트 충돌 확인**: 다른 애플리케이션이 같은 로컬 포트를 사용하고 있는지 확인

3. **방화벽 설정 확인**: 로컬 포트가 방화벽에 의해 차단되지 않았는지 확인

4. **애플리케이션 재시작**: 모든 포트포워딩을 중지하고 애플리케이션을 재시작

### 개발 모드에서 변경사항이 반영되지 않습니다

1. **브라우저 캐시 클리어**: 개발자 도구에서 Hard Reload (Cmd+Shift+R 또는 Ctrl+Shift+R)

2. **Vite 서버 재시작**: `npm run dev`를 중지하고 다시 시작

3. **빌드 캐시 삭제**:
```bash
rm -rf out node_modules/.vite
npm run dev
```

### 빌드 오류

1. **TypeScript 오류**: `tsconfig.json` 설정 확인

2. **의존성 문제**: 
```bash
rm -rf node_modules package-lock.json
npm install
```

3. **electron-vite 설정 오류**: `electron.vite.config.ts` 확인

## 라이선스

MIT

## 기여

버그 리포트나 기능 제안은 이슈로 등록해주세요. Pull Request도 환영합니다.

