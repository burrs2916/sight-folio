#!/bin/bash

# Sight Folio 启动脚本

# 设置 UTF-8 编码
export LANG=zh_CN.UTF-8
export LC_ALL=zh_CN.UTF-8

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 日志目录
LOG_DIR="$SCRIPT_DIR/logs"
VITE_LOG="$LOG_DIR/vite.log"
TAURI_LOG="$LOG_DIR/tauri.log"

# Vite 开发服务器端口（与 WorkMemory 的 23000 错开，避免两项目抢端口导致 project-sight dev server 起不来）
VITE_PORT=23010

# 产品信息
APP_NAME="Sight Folio"
APP_BUNDLE="$SCRIPT_DIR/src-tauri/target/release/bundle/macos/$APP_NAME.app"

# 日志函数
log_info() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] [INFO]${NC} $1"
}
log_error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] [ERROR]${NC} $1"
}
log_warn() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] [WARN]${NC} $1"
}
log_usage() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')] [USAGE]${NC} $1"
}

# 检查 Node.js 环境
check_node() {
    if ! command -v node &> /dev/null; then
        log_error "Node.js 未安装或不在 PATH 中"
        exit 1
    fi
    log_info "Node.js 版本: $(node --version)"
}

# 检查 npm 环境
check_npm() {
    if ! command -v npm &> /dev/null; then
        log_error "npm 未安装或不在 PATH 中"
        exit 1
    fi
    log_info "npm 版本: $(npm --version)"
}

# 检查 Rust 环境（可选，仅 tauri dev/build 时需要）
check_rust() {
    if ! command -v cargo &> /dev/null; then
        log_warn "Rust/Cargo 未安装，Tauri 模式不可用"
        return 1
    fi
    log_info "Rust 版本: $(cargo --version)"
    return 0
}

# 创建必要目录
create_directories() {
    mkdir -p "$LOG_DIR"
}

# 检查依赖
check_dependencies() {
    if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
        log_warn "依赖未安装，正在安装..."
        cd "$SCRIPT_DIR"
        npm install --legacy-peer-deps
        if [ $? -ne 0 ]; then
            log_error "依赖安装失败"
            exit 1
        fi
        log_info "依赖安装成功"
    fi
}

# 查找并停止 Vite 进程
stop_vite() {
    log_info "正在查找 Vite 进程..."
    VITE_PIDS=$(lsof -ti:${VITE_PORT} 2>/dev/null)
    if [ ! -z "$VITE_PIDS" ]; then
        log_warn "发现 Vite 进程占用端口 ${VITE_PORT}，正在停止..."
        kill -TERM $VITE_PIDS 2>/dev/null
        sleep 2
        REMAINING_PIDS=$(lsof -ti:${VITE_PORT} 2>/dev/null)
        if [ ! -z "$REMAINING_PIDS" ]; then
            log_warn "强制停止 Vite 进程..."
            kill -9 $REMAINING_PIDS 2>/dev/null
        fi
        log_info "Vite 进程已停止"
    else
        log_info "未发现 Vite 进程"
    fi
}

# 查找并停止 Tauri 进程
stop_tauri() {
    log_info "正在查找 Tauri 相关进程..."
    TAURI_PIDS=$(pgrep -f "tauri" 2>/dev/null || true)
    if [ ! -z "$TAURI_PIDS" ]; then
        log_warn "发现 Tauri 进程，正在停止..."
        kill -TERM $TAURI_PIDS 2>/dev/null
        sleep 2
        REMAINING_PIDS=$(pgrep -f "tauri" 2>/dev/null || true)
        if [ ! -z "$REMAINING_PIDS" ]; then
            log_warn "强制停止 Tauri 进程..."
            kill -9 $REMAINING_PIDS 2>/dev/null
        fi
        log_info "Tauri 进程已停止"
    else
        log_info "未发现 Tauri 进程"
    fi
}

# 查找并停止应用进程
stop_app() {
    log_info "正在查找应用进程..."
    APP_PIDS=$(pgrep -f "$APP_NAME" 2>/dev/null || true)
    if [ ! -z "$APP_PIDS" ]; then
        log_warn "发现应用进程，正在停止..."
        kill -TERM $APP_PIDS 2>/dev/null
        sleep 2
        REMAINING_PIDS=$(pgrep -f "$APP_NAME" 2>/dev/null || true)
        if [ ! -z "$REMAINING_PIDS" ]; then
            log_warn "强制停止应用进程..."
            kill -9 $REMAINING_PIDS 2>/dev/null
        fi
        log_info "应用进程已停止"
    else
        log_info "未发现应用进程"
    fi
}

# 停止所有相关进程
stop_all_processes() {
    log_info "正在停止所有相关进程..."
    stop_vite
    stop_app
    log_info "所有相关进程已停止"
}

# 前置检查（前端模式）
pre_check_fe() {
    check_node
    check_npm
    create_directories
    check_dependencies
}

# 前置检查（Tauri 模式）
pre_check_tauri() {
    check_node
    check_npm
    check_rust
    create_directories
    check_dependencies
}

# 启动前端开发服务器
start_dev() {
    log_info "$APP_NAME 开发模式启动（Vite + Rust 编译 + 窗口）"
    echo "========================================"

    # 前置检查（含 Rust）
    pre_check_tauri

    # 停止可能残留的进程
    stop_all_processes

    log_info "启动中，日志实时显示（按 Ctrl+C 停止所有服务）..."
    echo ""

    # 前台运行 tauri dev（自动管理 vite + Rust 编译 + 弹出窗口）
    cd "$SCRIPT_DIR"
    npx tauri dev 2>&1 | tee -a "$TAURI_LOG"
}

# 启动 Tauri 开发模式（前后端同时启动）
start_tauri_dev() {
    log_info "$APP_NAME Tauri 开发模式启动"
    echo "========================================"

    pre_check_tauri
    stop_all_processes

    log_info "启动 Tauri dev（自动管理 vite + Rust 编译）..."
    cd "$SCRIPT_DIR"
    npx tauri dev 2>&1 | tee "$TAURI_LOG"
}

# 构建前端
build_frontend() {
    log_info "正在构建 $APP_NAME 前端..."
    pre_check_fe
    cd "$SCRIPT_DIR"
    log_info "正在构建..."
    npm run build
    if [ $? -ne 0 ]; then
        log_error "前端构建失败"
        exit 1
    fi
    log_info "前端构建成功"
    log_info "输出目录: $SCRIPT_DIR/dist"
}

# 构建 Tauri 应用
build_tauri() {
    log_info "正在构建 $APP_NAME Tauri 应用..."
    pre_check_tauri
    cd "$SCRIPT_DIR"
    log_info "正在构建 Tauri 应用..."
    npm run tauri build
    if [ $? -ne 0 ]; then
        log_error "Tauri 应用构建失败"
        exit 1
    fi
    log_info "Tauri 应用构建成功"
    log_info "产物: $APP_BUNDLE"
}

# 停止服务
stop_services() {
    log_info "$APP_NAME 停止脚本"
    echo "========================================"
    stop_all_processes
}

# 显示帮助
show_help() {
    echo "$APP_NAME 管理脚本"
    echo ""
    echo "用法: $0 [选项]"
    echo ""
    echo "选项:"
    echo "  dev              启动前端开发服务器（纯前端，浏览器访问）"
    echo "  tauri-dev        启动 Tauri 开发模式（前后端同时启动）"
    echo "  stop             停止所有相关进程"
    echo "  build            构建前端"
    echo "  build-tauri      构建 Tauri 应用"
    echo "  help, -h, --help 显示此帮助信息"
    echo ""
    echo "示例:"
    echo "  $0               # 启动前端开发服务器"
    echo "  $0 dev           # 启动前端开发服务器"
    echo "  $0 tauri-dev     # 启动 Tauri 开发模式"
    echo "  $0 stop          # 停止所有相关进程"
    echo "  $0 build         # 构建前端"
    echo "  $0 build-tauri   # 构建 Tauri 应用"
}

# 主函数
main() {
    case "${1:-dev}" in
        dev|"")
            start_dev
            ;;
        tauri-dev)
            start_tauri_dev
            ;;
        stop)
            stop_services
            ;;
        build)
            build_frontend
            ;;
        build-tauri)
            build_tauri
            ;;
        help|-h|--help)
            show_help
            ;;
        *)
            log_error "未知选项: $1"
            log_usage "使用 '$0 help' 查看帮助信息"
            exit 1
            ;;
    esac
}

main "$@"
