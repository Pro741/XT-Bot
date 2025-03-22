import path from 'path';
import {formatDateToLocalISO} from "./utils";
import {get} from "lodash";
import fs from "fs-extra";

// 类型定义 ------------------------------------------------------------------------
interface UserInfo {
    screenName: string;
    userId: string;
}

interface EnrichedTweet {
    user: {
        screenName: string;
        name: string;
    };
    images: string[];
    videos: string[];
    expandUrls: string[];
    tweetUrl: string;
    fullText: string;
    publishTime: string;
}

interface ProcessConfig {
    /** 输出目录路径，默认 './output' */
    outputDir?: string;
    /** 是否强制刷新用户信息，默认 false */
    forceRefresh?: boolean;
    /** 请求间隔时间（毫秒），默认 5000 */
    interval?: number;
}

// 主函数 -------------------------------------------------------------------------
/**
 * 主处理流程：根据用户名获取推文并处理
 * @param screenName 推特用户名（不含@）
 * @param client Twitter API 客户端
 * @param config 配置选项
 */
export async function processTweetsByScreenName(
    screenName: string,
    client: any,
    config: ProcessConfig = {}
) {
    const startTime = Date.now();
    console.log(`===== ===== ===== ===== ===== ===== ===== ===== ===== =====`);
    console.log(`🚀 开始处理用户 @${screenName}`);

    try {
        // 合并配置参数
        const {
            outputDir = '../resp/respTweets',
            forceRefresh = false,
            interval = 5000
        } = config;

        // 步骤1: 获取用户ID ---------------------------------------------------------
        console.log('🔍 正在查询用户信息...');
        const userInfo = await getOrFetchUserInfo(screenName, client, forceRefresh);
        console.log(`✅ 获取用户信息成功：
          - 用户名: @${userInfo.screenName}
          - 用户ID: ${userInfo.userId}`);

        // 步骤2: 定义输出路径 -------------------------------------------------------
        const outputFileName = `${userInfo.screenName}.json`;
        const finalOutputPath = path.join('../tweets/user/', outputFileName);
        const rawOutputPath = path.join(outputDir, `${userInfo.userId}.json`);

        // 确保目录存在
        fs.ensureDirSync(path.dirname(finalOutputPath));
        fs.ensureDirSync(path.dirname(rawOutputPath));

        // 步骤3: 获取并处理推文 -----------------------------------------------------
        console.log('⏳ 开始获取推文数据...');
        const {processedCount, rawTweets} = await processTweets(
            userInfo.userId,
            client,
            {
                interval,
                rawOutputPath
            }
        );

        // 步骤4: 合并历史数据 -------------------------------------------------------
        console.log('🔄 正在合并历史数据...');
        const finalData = mergeAndSaveData(
            finalOutputPath,
            rawTweets,
            userInfo.userId
        );

        // 最终统计 -----------------------------------------------------------------
        const timeCost = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`
🎉 处理完成！
├── 用户：@${userInfo.screenName} (ID: ${userInfo.userId})
├── 本次获取：${processedCount} 条新推文
├── 历史累计：${finalData.length} 条推文
├── 耗时：${timeCost} 秒
└── 输出路径：${finalOutputPath}
        `);

        return finalData;

    } catch (error) {
        console.error(`❌ 处理用户 @${screenName} 失败：`, error);
        throw error;
    }
}

// 核心工具函数 -------------------------------------------------------------------
/**
 * 获取/缓存用户信息
 */
async function getOrFetchUserInfo(
    screenName: string,
    client: any,
    forceRefresh: boolean
): Promise<UserInfo> {
    const cacheDir = path.join('../resp/cache');
    const cachePath = path.join(cacheDir, `${screenName}.json`);

    // 尝试读取缓存
    if (!forceRefresh && fs.existsSync(cachePath)) {
        const cached = await fs.readJSON(cachePath);
        if (cached.userId) {
            console.log(`📦 使用缓存用户信息：@${screenName}`);
            return cached;
        }
    }

    // 调用API获取新数据
    console.log(`🌐 正在请求API获取用户信息：@${screenName}`);
    const response = await client.getUserApi().getUserByScreenName({screenName});

    if (!response.data?.user?.restId) {
        throw new Error(`未找到用户 @${screenName}`);
    }

    // 构建用户信息
    const userInfo: UserInfo = {
        screenName: screenName,
        userId: response.data.user.restId
    };

    // 写入缓存
    fs.ensureDirSync(cacheDir);
    await fs.writeJSON(cachePath, userInfo, {spaces: 2});
    return userInfo;
}

/**
 * 处理推文的核心流程
 */
async function processTweets(
    userId: string,
    client: any,
    options: {
        interval: number;
        rawOutputPath: string;
    }
) {
    let pageCount = 0;
    let processedCount = 0;
    const rawTweets: any[] = [];

    // 创建请求处理器
    const requestHandler = async (cursor?: string) => {
        pageCount++;

        // 添加请求开始日志
        console.log(`\n=== 第 ${pageCount} 次请求 ===`);
        console.log(`🕒 请求时间: ${new Date().toISOString()}`);
        console.log(`🎯 目标用户ID: ${userId}`);
        if (cursor) console.log(`📍 当前游标: ${cursor}`);

        // 间隔控制
        if (pageCount > 1) {
            console.log(`⏸️ 等待 ${options.interval / 1000} 秒...`);
            await new Promise(r => setTimeout(r, options.interval));
        }

        // 执行请求
        const response = await client.getTweetApi().getUserTweets({
            userId,
            cursor,
            count: 20
        });

        // 添加响应日志
        const responseCount = response.data?.data?.length || 0;
        console.log(`🔄 获取到 ${responseCount} 条推文`);

        // 记录原始数据
        if (response.data?.data?.length) {
            rawTweets.push(...response.data.data);
            await fs.appendFile(
                options.rawOutputPath,
                response.data.data.map(JSON.stringify).join('\n') + '\n'
            );
        } else {
            console.log("⚠️ 本次请求未获取到数据");
        }

        return {
            data: {
                data: response.data?.data || [],
                cursor: response.data?.cursor
            }
        };
    };

    // 修改后的分页生成器
    const tweetGenerator = tweetCursor({limit: Infinity}, requestHandler);

    // 添加进度统计
    let totalFetched = 0;
    for await (const tweet of tweetGenerator) {
        processedCount++;
        totalFetched++;

        // 每50条输出进度
        if (processedCount % 50 === 0) {
            console.log(`📌 已处理 ${processedCount} 条（本次请求累计 ${totalFetched} 条）`);
        }
    }

    console.log(`\n=== 请求结束 ===`);
    console.log(`📈 总计获取: ${totalFetched} 条`);
    console.log(`📦 原始数据量: ${rawTweets.length} 条`);

    return {processedCount, rawTweets};
}

/**
 * 数据合并与保存
 */
function mergeAndSaveData(
    outputPath: string,
    newTweets: any[],
    userId: string
): EnrichedTweet[] {
    // 读取历史数据
    let existingData: EnrichedTweet[] = [];
    try {
        if (fs.existsSync(outputPath)) {
            existingData = fs.readJSONSync(outputPath);
            console.log(`📚 读取到历史数据 ${existingData.length} 条`);
        }
    } catch (e) {
        console.warn('⚠️ 读取历史数据失败，将创建新文件:', e.message);
    }

    // 转换新数据
    console.log('🔄 正在处理原始推文数据...');
    const newData = newTweets
        .map(tweet => transformTweet(tweet, userId))
        .filter(t => {
            if (!t) console.log(`🗑️ 过滤无效数据`);
            return t !== null;
        });

    console.log(`\n=== 数据合并统计 ===`);
    console.log(`📥 新数据: ${newData.length} 条（原始 ${newTweets.length} 条）`);
    console.log(`📚 历史数据: ${existingData.length} 条`);

    // 合并去重
    const merged = [...existingData, ...newData];
    const uniqueMap = new Map(merged.map(t => [t.tweetUrl, t]));
    console.log(`🔍 去重后: ${uniqueMap.size} 条（减少 ${merged.length - uniqueMap.size} 条重复）`);

    // 按时间升序排序
    const sorted = Array.from(uniqueMap.values()).sort((a, b) =>
        a.publishTime.localeCompare(b.publishTime)
    );

    // 保存数据
    fs.writeFileSync(outputPath, JSON.stringify(sorted, null, 2));
    return sorted;
}

/**
 * 推文数据转换
 */
function transformTweet(tweet: any, userId: string): EnrichedTweet | null {
    // 安全访问工具函数
    const safeGet = (path: string, defaultValue: any = '') => get(tweet, path, defaultValue);

    /* 核心字段提取 */
    // 推文内容（使用完整文本字段）
    const fullText = safeGet('raw.result.legacy.fullText', safeGet('text', ''));

    // 推文发布时间（处理Twitter特殊日期格式）
    const createdAt = safeGet('raw.result.legacy.createdAt', safeGet('text', '1970-01-01T00:00:00'));
    const publishTime = formatDateToLocalISO(createdAt);

    /* 用户信息提取 */
    const user = {
        screenName: safeGet('user.legacy.screenName', 'unknown'),
        name: safeGet('user.legacy.name', 'Unknown User')
    };

    /* 多媒体内容处理 */
    // 图片提取（类型为photo的媒体）
    const mediaItems = safeGet('raw.result.legacy.extendedEntities.media', []);
    const images = mediaItems
        .filter((m: any) => m.type === 'photo')
        .map((m: any) => m.mediaUrlHttps)
        .filter(Boolean);

    // 视频提取（包括animated_gif类型）
    const videos = mediaItems
        .filter((m: any) => ['video', 'animated_gif'].includes(m.type))
        .map((m: any) => {
            const variants = m.videoInfo?.variants || [];
            return variants
                .filter((v: any) => v.contentType === 'video/mp4')
                .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0]?.url;
        })
        .filter(Boolean);

    /* 链接处理 */
    const expandUrls = safeGet('raw.result.legacy.entities.urls', [])
        .map((u: any) => u.expandedUrl)
        .filter(Boolean);

    /* 推文URL构造 */
    const tweetId = safeGet('raw.result.legacy.idStr', safeGet('id'));
    if (!tweetId || !user.screenName) {
        console.log(`❌ 无效推文结构：${JSON.stringify({
            // 核心标识字段
            invalidFields: {
                'raw.result.legacy.idStr': safeGet('raw.result.legacy.idStr'),
                'id': safeGet('id'),
                'user.legacy.screenName': safeGet('user.legacy.screenName'),

                // 关键内容字段
                'hasFullText': !!safeGet('raw.result.legacy.fullText'),
                'hasText': !!safeGet('text'),

                // 时间相关
                'createdAtExists': !!safeGet('raw.result.legacy.createdAt'),

                // 用户身份验证
                'currentUserIdMatch': safeGet('user.rest_id') === userId,

                // 媒体相关
                'hasMedia': mediaItems.length > 0,
                'hasEntitiesUrls': safeGet('raw.result.legacy.entities.urls', []).length > 0,

                // 结构完整性
                'rawResultExists': !!safeGet('raw.result'),
                'legacyObjectExists': !!safeGet('raw.result.legacy')
            },
            metadata: {
                tweetId: tweetId,
                currentUserId: userId,
                receivedUserRestId: safeGet('user.rest_id'),
                timestamp: new Date().toISOString()
            }
        }, null, 2)}`);
        return null;
    }
    const tweetUrl = `https://x.com/${user.screenName}/status/${tweetId}`;

    console.log(`✅ 转换成功：${tweetUrl}`);
    return {
        user,
        images,
        videos,
        expandUrls,
        tweetUrl,
        fullText, // 替换换行符
        publishTime
    };
}

/**
 * 分页生成器实现
 */
async function* tweetCursor(
    params: { limit: number },
    request: (cursor?: string) => Promise<any>
) {
    let cursor: string | undefined;
    let count = 0;
    let emptyCount = 0;

    do {
        const response = await request(cursor);
        const tweets = response.data?.data || [];
        const newCursor = response.data?.cursor?.bottom?.value;

        // 添加分页日志
        console.log(`📌 累计已处理: ${count} 条`);

        // 终止条件判断
        if (tweets.length === 0) {
            emptyCount++;
            console.log(`❌ 空数据计数: ${emptyCount}/3`);
            if (emptyCount >= 3) {
                console.log("⏹️ 终止原因：连续3次空响应");
                return;
            }
        } else {
            emptyCount = 0;
        }

        // 处理数据
        for (const tweet of tweets) {
            yield tweet;
            if (++count >= params.limit) {
                console.log(`⏹️ 终止原因：达到数量限制（${params.limit}）`);
                return;
            }
        }

        cursor = newCursor;

    } while (true);
}
