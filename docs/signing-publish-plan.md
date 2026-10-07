# Sight Folio 签名与发布方案

> 维护者：项目作者　|　更新：2026-10-07
> 状态：CI 全链路已核验通过，签名材料待用户提供后启用

## 1. 现状盘点

### 1.1 CI 全链路（本地核验结果）

| 环节         | CI 命令                                         | 结果                                                        |
| ------------ | ----------------------------------------------- | ----------------------------------------------------------- |
| 前端类型检查 | `npx tsc --noEmit`                              | ✅ 通过                                                     |
| 前端 Lint    | `npm run lint`                                  | ✅ 通过（0 error，382 条既有 warning 不阻塞）               |
| 前端构建     | `npx vite build`                                | ✅ 通过                                                     |
| 前端单测     | `npm test`                                      | ✅ 114 文件 / 1429 用例全绿                                 |
| Rust fmt     | `cargo fmt -- --check`                          | ✅ 通过（已全库格式化并单独提交）                           |
| Rust clippy  | `cargo clippy --all-features -- -W clippy::all` | ✅ 通过（179 条既有 warning，CI 未开 `-D warnings` 不阻塞） |
| Rust 测试    | `cargo test --all-features`                     | ✅ 779 passed / 0 failed / 10 ignored                       |

本轮为让 CI 转绿已提交 4 个修复：

- `style(rust): cargo fmt 全库格式化` —— 仓库历史从未跑过 rustfmt 的格式欠账一次清掉
- `fix(test): 修复 project_scan 与 code_patch 的 5 个基线失败测试`
- `fix(test): DraftInput 测试 teardown 清理遗留落库定时器，消除 vitest teardown error`
- `fix(ci): 修正 releaseBody 中 AppImage 运行命令笔误（././ → ./）`

### 1.2 发布流水线（publish-tauri）

- 触发条件：push 到 `main` 或打 `v*` tag（`prerelease` 取决于是否 tag）
- 四个平台矩阵：macOS arm64 / macOS x64 / Linux / Windows
- 使用 `tauri-apps/tauri-action@v0`，`tagName: app-v__VERSION__`，自动建 Release 并上传产物
- 当前配置问题：**macOS 为 ad-hoc 签名（`signingIdentity: "-"`）**，用户安装会触发 Gatekeeper 拦截（需右键打开 / 隐私与安全手动放行）；Windows 与 Linux 无签名。

## 2. macOS 正式签名 + 公证（推荐方案）

> 依据：Tauri v2 官方文档 [macOS Code Signing](https://v2.tauri.app/distribute/sign/macos/)

对外分发（非 App Store）需要 **Developer ID Application** 证书（付费开发者账号 $99/年；免费账号无法公证）。签名后必须公证（Notarization），否则下载的 App 仍会提示「已损坏」。

### 2.1 需用户提供的材料

1. **Developer ID Application 证书**（.cer，从 Apple 开发者后台 Certificates 页面下载，仅 Account Holder 可创建）
2. 从 Keychain 导出的 **.p12 文件 + 导出密码**（用于 CI；本地签名只需证书装在登录钥匙串里）
3. **公证凭证二选一**：
   - 推荐（更安全）：App Store Connect API Key —— 后台「用户和访问 → 集成」新建，下载 `AuthKey_<KEY_ID>.p8`（仅可下载一次，注意文件名中的 KEY_ID）；需要 **Issuer ID**（Issuer）与 **Key ID**
   - 备用：Apple ID 邮箱 + App-Specific Password（[appleid.apple.com](https://appleid.apple.com) 生成）+ **Team ID**（开发者后台 Membership 页）

### 2.2 配置步骤

**本地签名（开发机）**：证书装入登录钥匙串后，将 `tauri.conf.json` 的 `bundle.macOS.signingIdentity` 从 `"-"` 改为 `security find-identity -v -p codesigning` 输出的证书 Common Name，然后 `npm run tauri build`。

**CI 签名（GitHub Actions）× 3 步**：

1. 导出 p12 → base64：`openssl base64 -A -in certificate.p12 -out certificate-base64.txt`
2. 在仓库 Settings → Secrets and variables → Actions 配置以下 secrets（见 §4 清单）
3. 在 `ci.yml` 的 publish-tauri 增加「导入 Apple 证书」step（官方模板见下），并给 macOS 矩阵注入公证环境变量：

```yaml
- name: Import Apple Developer Certificate
  if: startsWith(matrix.platform, 'macOS')
  env:
    APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
    APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
    KEYCHAIN_PASSWORD: ${{ secrets.KEYCHAIN_PASSWORD }}
  run: |
    echo $APPLE_CERTIFICATE | base64 --decode > certificate.p12
    security create-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
    security default-keychain -s build.keychain
    security unlock-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
    security set-keychain-settings -t 3600 -u build.keychain
    security import certificate.p12 -k build.keychain -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
    security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" build.keychain
    CERT_ID=$(security find-identity -v -p codesigning build.keychain | grep -o '"Developer ID Application: [^"]*"' | head -1 | tr -d '"')
    echo "CERT_ID=$CERT_ID" >> $GITHUB_ENV
```

4. 将 `tauri.conf.json` 的 `bundle.macOS.signingIdentity` 改为 `"-"` 或留 CI 用 `APPLE_SIGNING_IDENTITY: ${{ env.CERT_ID }}` 覆盖，并在 tauri-action 的 env 里注入公证凭证（推荐 API Key 方式）：

```yaml
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  APPLE_SIGNING_IDENTITY: ${{ env.CERT_ID }}
  APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
  APPLE_API_KEY: ${{ secrets.APPLE_API_KEY }}
  APPLE_API_KEY_PATH: ${{ secrets.APPLE_API_KEY_PATH }}
```

> 注意：`bundle.macOS.notarization` 依赖这些环境变量在构建进程中存在；使用 Developer ID 签名时公证为必需，首次可 `--skip-stapling` 验证后再完整公证。

## 3. Windows 代码签名（推荐方案）

> 依据：Tauri v2 官方文档 [Windows Code Signing](https://v2.tauri.app/distribute/sign/windows/)

Windows 上未签名安装包会触发 SmartScreen 「未知发布者」拦截。个人开发者可用 **OV（组织验证）代码签名证书**（比 EV 便宜且可直接购买，注意 EV 自 2024 年起也不再即时获得 SmartScreen 信誉，需靠持续签名积累）。

### 3.1 需用户提供的材料

1. **代码签名证书**（务必是 code signing 类型，SSL 证书无效）+ 私钥（.cer + .key 或直接 .pfx）
2. 从证书商处获取 **timestamp URL**（时间戳服务器，如证书商提供的地址；示例 `http://timestamp.digicert.com`）

### 3.2 配置步骤

1. 本地转换为 .pfx：`openssl pkcs12 -export -in cert.cer -inkey private-key.key -out certificate.pfx`（记住导出密码）
2. `tauri.conf.json` 增加 `bundle.windows` 段：

```json
{
  "bundle": {
    "windows": {
      "certificateThumbprint": "<从 certmgr.msc 详情页复制，如 A1B1A2B2...>",
      "digestAlgorithm": "sha256",
      "timestampUrl": "<证书商提供的时间戳 URL>"
    }
  }
}
```

3. CI 中在 tauri-action 之前加导入证书 step（官方模板），secrets 见 §4：

```yaml
- name: Import Windows certificate
  if: matrix.platform == 'Windows'
  env:
    WINDOWS_CERTIFICATE: ${{ secrets.WINDOWS_CERTIFICATE }}
    WINDOWS_CERTIFICATE_PASSWORD: ${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}
  shell: pwsh
  run: |
    New-Item -ItemType directory -Path certificate
    Set-Content -Path certificate/tempCert.txt -Value $env:WINDOWS_CERTIFICATE
    certutil -decode certificate/tempCert.txt certificate/certificate.pfx
    Remove-Item -Path certificate/tempCert.txt
    Import-PfxCertificate -FilePath certificate/certificate.pfx -CertStoreLocation Cert:\CurrentUser\My -Password (ConvertTo-SecureString -String $env:WINDOWS_CERTIFICATE_PASSWORD -Force -AsPlainText)
```

> 备选无证书方案：Azure Trusted Signing（Azure Artifact Signing）通过 `signCommand` 配置 `artifact-signing-cli`，缺点是依赖 Azure 账号与费用，个人项目不优先推荐。

## 4. GitHub Actions Secrets 清单（需用户配置）

| Secret 名                                               | 用途                                                                     | 必填平台   |
| ------------------------------------------------------- | ------------------------------------------------------------------------ | ---------- |
| `APPLE_CERTIFICATE`                                     | macOS p12 证书 base64                                                    | macOS      |
| `APPLE_CERTIFICATE_PASSWORD`                            | p12 导出密码                                                             | macOS      |
| `KEYCHAIN_PASSWORD`                                     | CI 临时钥匙串密码（任意强密码）                                          | macOS      |
| `APPLE_API_ISSUER`（推荐）                              | App Store Connect API Issuer ID                                          | macOS 公证 |
| `APPLE_API_KEY`（推荐）                                 | App Store Connect API Key ID                                             | macOS 公证 |
| `APPLE_API_KEY_PATH`（推荐）                            | p8 私钥内容（CI 需先写入临时文件再指定路径）                             | macOS 公证 |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`（备用） | Apple ID 公证凭证（password 须为 App-Specific Password）                 | macOS 公证 |
| `WINDOWS_CERTIFICATE`                                   | Windows .pfx base64（`certutil -encode certificate.pfx base64cert.txt`） | Windows    |
| `WINDOWS_CERTIFICATE_PASSWORD`                          | pfx 导出密码                                                             | Windows    |
| `GITHUB_TOKEN`                                          | Action 内置，无需配置                                                    | 全部       |

设置入口：GitHub 仓库 → Settings → Secrets and variables → Actions。

## 5. 落地清单

**待用户提供材料后实施：**

- [ ] 购买/申请 Apple Developer 付费账号，创建并下载 Developer ID Application 证书
- [ ] 提供或生成 App Store Connect API Key（推荐）或 Apple ID App-Specific Password + Team ID
- [ ] 购买 Windows OV 代码签名证书（携私钥的 .cer/.pfx + timestamp URL）
- [ ] 配置 §4 的全部 secrets
- [ ] 在 `ci.yml` 增加 macOS 证书导入 step 与公证环境变量（§2.2）
- [ ] 在 `ci.yml` 增加 Windows 证书导入 step（§3.2）
- [ ] 将 `tauri.conf.json` 的 `signingIdentity: "-"` 替换为正式签名身份（本地）或保留 `-` 由 CI 的 `APPLE_SIGNING_IDENTITY` 覆盖
- [ ] 打 `v0.2.0` tag 触发一次真实发布，验证 Release 产物（DMG 可正常安装、Windows 安装包 SmartScreen 表现、Linux AppImage 可执行）
- [ ] 更新 README「构建与发布」一节：删除 ad-hoc 说明，改为签名发布步骤

**不加签名也能先发布（临时方案）：**

- 现状 ad-hoc：macOS 用户需右键打开或系统设置放行（releaseBody 已写明指引）；Windows SmartScreen 提示「更多信息 → 仍要运行」
- 适合内测/早期分发，正式对外建议尽快启用签名
