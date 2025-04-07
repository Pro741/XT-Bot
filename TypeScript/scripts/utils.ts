import {TwitterOpenApi} from "twitter-openapi-typescript";
import axios from "axios";
import {TwitterApi} from 'twitter-api-v2';

export const _xClient = async (TOKEN: string) => {
    console.log("🚀 ~ const_xClient= ~ TOKEN:", TOKEN)
    const resp = await axios.get("https://x.com/manifest.json", {
        headers: {
            cookie: `auth_token=${TOKEN}`,
        },
    });

    const resCookie = resp.headers["set-cookie"] as string[];
    const cookieObj = resCookie.reduce((acc: Record<string, string>, cookie: string) => {
        const [name, value] = cookie.split(";")[0].split("=");
        acc[name] = value;
        return acc;
    }, {});

    console.log("🚀 ~ cookieObj ~ cookieObj:", JSON.stringify(cookieObj, null, 2))

    const api = new TwitterOpenApi();
    const client = await api.getClientFromCookies({...cookieObj, auth_token: TOKEN});
    return client;
};

export const xGuestClient = () => _xClient(process.env.GET_ID_X_TOKEN!);
export const XAuthClient = () => _xClient(process.env.AUTH_TOKEN!);


export const login = async (AUTH_TOKEN: string) => {
    const resp = await axios.get("https://x.com/manifest.json", {
        headers: {
            cookie: `auth_token=${AUTH_TOKEN}`,
        },
    });

    const resCookie = resp.headers["set-cookie"] as string[];
    const cookie = resCookie.reduce((acc: Record<string, string>, cookie: string) => {
        const [name, value] = cookie.split(";")[0].split("=");
        acc[name] = value;
        return acc;
    }, {});
    cookie.auth_token = AUTH_TOKEN;

    const api = new TwitterOpenApi();
    const client = await api.getClientFromCookies(cookie);

    const plugin = {
        onBeforeRequest: async (params: any) => {
            params.computedParams.headers = {
                ...params.computedParams.headers,
                ...client.config.apiKey,
                'x-csrf-token': cookie.ct0,
                'x-twitter-auth-type': 'OAuth2Session',
                authorization: `Bearer ${TwitterOpenApi.bearer}`,
                cookie: api.cookieEncode(cookie),
            };
            params.requestOptions.headers = {
                ...params.requestOptions.headers,
                ...client.config.apiKey,
                'x-csrf-token': cookie.ct0,
                'x-twitter-auth-type': 'OAuth2Session',
                authorization: `Bearer ${TwitterOpenApi.bearer}`,
                cookie: api.cookieEncode(cookie),
            };
        },
    };

    const legacy = new TwitterApi('_', {plugins: [plugin]});

    return {client, legacy};
}

export function formatDateToLocalISO(createdAt: string): string {
    const date = new Date(createdAt);

    // 如果是无效日期，直接返回原始参数
    if (isNaN(date.getTime())) {
        return createdAt;
    }

    const options: Intl.DateTimeFormatOptions = {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    };

    const formatter = new Intl.DateTimeFormat('en-CN', options);
    const parts = formatter.formatToParts(date);

    const components: Record<string, string> = {};
    parts.forEach(({type, value}) => {
        components[type] = value;
    });

    return `${components.year}-${components.month}-${components.day}T${components.hour}:${components.minute}:${components.second}`;
}
