import type { UiStatusMessage } from './uiLocale';

/** Display-only adapter for exact local wrappers. Unknown service text stays literal. */
export const getServiceConnectionUi = (
    service: 'notion' | 'feishu' | 'mcp', message: string,
): UiStatusMessage | undefined => {
    let match: RegExpMatchArray | null;
    if (service !== 'mcp') {
        if ((match = message.match(/^连接失败: ([\s\S]*)$/))) return { key: 'settings.service.failed', params: { detail: match[1] } };
        if ((match = message.match(/^网络错误: ([\s\S]*)$/))) return { key: 'settings.realtime.networkError', params: { error: match[1] } };
        if (service === 'notion') {
            if ((match = message.match(/^连接成功！数据库: ([\s\S]*)$/))) return { key: 'settings.service.notionSuccess', params: { name: match[1] } };
            if (message === '返回格式错误') return { key: 'settings.service.invalidResponse' };
            if ((match = message.match(/^无法连接到代理服务器 ([\s\S]*)：请先在浏览器里试试能否直接打开该地址。打不开说明当前网络访问不了它（换网络\/开代理后重试），或在「设置 → 网络代理 \(Worker\)」填入自部署的 Worker 地址$/))) return { key: 'settings.service.proxyUnreachable', params: { url: match[1] } };
        } else {
            if ((match = message.match(/^获取token失败: ([\s\S]*)$/))) return { key: 'settings.service.feishuTokenFailed', params: { detail: match[1] } };
            if (message === '飞书错误: 未知错误') return { key: 'settings.service.feishuUnknown' };
            if ((match = message.match(/^读取连接成功！数据表: ([\s\S]*)。注意：这里不创建测试记录，新增记录权限会在角色首次写日记时验证。$/))) return { key: 'settings.service.feishuSuccess', params: { name: match[1] } };
            if (message === '飞书错误: 请检查多维表格权限') return { key: 'settings.service.feishuPermission' };
            if ((match = message.match(/^飞书错误: ([\s\S]*)$/))) return { key: 'settings.service.feishuError', params: { detail: match[1] } };
            if ((match = message.match(/^多维表格中未找到表 ([\s\S]*)。可用表: ([\s\S]*)$/))) return { key: match[2] === '无' ? 'settings.service.tableMissingEmpty' : 'settings.service.tableMissing', params: { id: match[1], tables: match[2] } };
        }
        return undefined;
    }
    if ((match = message.match(/^MCP 请求超时（(\d+) 秒）$/))) return { key: 'settings.service.mcpTimeout', params: { seconds: match[1] } };
    if ((match = message.match(/^MCP 鉴权失败 \((401|403)\): Token 可能无效或过期。([\s\S]*)$/))) return { key: 'settings.service.mcpAuth', params: { status: match[1], detail: match[2] } };
    if ((match = message.match(/^MCP HTTP (\d+): ([\s\S]*)$/))) return { key: 'settings.service.mcpHttp', params: { status: match[1], detail: match[2] } };
    if ((match = message.match(/^(Initialize|tools\/list) 失败: ([\s\S]*)$/))) return { key: 'settings.service.mcpOperation', params: { operation: match[1], detail: match[2] } };
    if ((match = message.match(/^MCP: 无法解析响应: ([\s\S]*)$/))) return { key: 'settings.service.mcpParse', params: { detail: match[1] } };
    if (message === 'MCP SSE 流结束，但没有收到本次请求的响应') return { key: 'settings.service.mcpSse' };
    if ((match = message.match(/^MCP 请求失败: ([\s\S]*)。请检查代理 URL 是否可访问、代理密钥是否正确。$/))) return { key: 'settings.service.mcpFetchProxy', params: { detail: match[1] } };
    if ((match = message.match(/^MCP 请求失败: ([\s\S]*)。很可能是浏览器 CORS 限制。请在这个服务器的「代理 URL」里配置代理（本地 node scripts\/mcp-proxy.mjs 或自部署 worker\/mcp-proxy）。$/))) return { key: 'settings.service.mcpFetchCors', params: { detail: match[1] } };
    if ((match = message.match(/^MCP 请求失败: ([\s\S]*)。$/))) return { key: 'settings.service.mcpFetch', params: { detail: match[1] } };
    if ((match = message.match(/^MCP 协议版本不兼容：服务器选择了 ([\s\S]*)。SullyOS 的 Streamable HTTP 接线支持 ([\s\S]*)；2024-11-05 属于旧 HTTP\+SSE 双端点，2026-07-28 则需要新的无握手生命周期。$/))) return { key: 'settings.service.mcpProtocol', params: { selected: match[1], supported: match[2] } };
    return undefined;
};
