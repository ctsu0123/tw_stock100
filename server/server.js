require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const yahooFinance = require('yahoo-finance2').default;

// 全球主要指數映射
const INDICES = {
    // 美國市場
    '^GSPC': { name: '標普500', symbol: '^GSPC' },
    '^DJI': { name: '道瓊工業', symbol: '^DJI' },
    '^IXIC': { name: '納斯達克', symbol: '^IXIC' },
    '^RUT': { name: '羅素2000', symbol: '^RUT' },
    '^VIX': { name: '恐慌指數', symbol: '^VIX' },
    
    // 亞洲市場
    '^TWII': { name: '台灣加權', symbol: '^TWII' },
    '^N225': { name: '日經225', symbol: '^N225' },
    '^HSI': { name: '恒生指數', symbol: '^HSI' },
    '000001.SS': { name: '上證指數', symbol: '000001.SS' }
};

// 緩存設置
let indicesCache = {
    data: null,
    timestamp: 0
};
const CACHE_DURATION = 5 * 60 * 1000; // 5分鐘緩存

// 初始化 Express 應用程式
const app = express();

// 啟用 CORS
app.use(cors());

// 解析 JSON 請求體
app.use(express.json());

// 提供靜態檔案 (前端)
app.use(express.static(path.join(__dirname, '..')));

// 獲取前一個交易日
function getPreviousTradingDay(date) {
    const newDate = new Date(date);
    newDate.setDate(newDate.getDate() - 1);
    
    // 如果是週日 (0) 或週六 (6)，再往前推
    if (newDate.getDay() === 0) {
        newDate.setDate(newDate.getDate() - 2);
    } else if (newDate.getDay() === 6) {
        newDate.setDate(newDate.getDate() - 1);
    }
    
    return newDate;
}

// 格式化日期為 YYYYMMDD
function formatDate(date) {
    return date.getFullYear() +
           String(date.getMonth() + 1).padStart(2, '0') +
           String(date.getDate()).padStart(2, '0');
}

// 獲取股票資料
async function fetchStockData(dateStr) {
    console.log(`嘗試取得 ${dateStr} 的股票資料`);
    
    // 嘗試使用 MI_INDEX API
    try {
        const response = await axios.get(
            `https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=${dateStr}&type=ALL`,
            { 
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            }
        );
        
        if (response.data.stat === 'OK' && response.data.data9) {
            console.log(`成功從 MI_INDEX 取得 ${dateStr} 的股票資料，共 ${response.data.data9.length} 筆`);
            return {
                data: response.data,
                isHistoricalData: false
            };
        }
    } catch (error) {
        console.warn(`MI_INDEX API 請求失敗:`, error.message);
    }
    
    // 如果 MI_INDEX 失敗，嘗試使用 STOCK_DAY_ALL
    try {
        console.log('嘗試使用 STOCK_DAY_ALL API 取得資料...');
        const response = await axios.get(
            'https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL',
            {
                params: {
                    response: 'json',
                    date: dateStr
                },
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            }
        );
        
        if (response.data.stat === 'OK' && response.data.data) {
            console.log(`成功從 STOCK_DAY_ALL 取得 ${dateStr} 的股票資料，共 ${response.data.data.length} 筆`);
            
            // 轉換資料格式以符合前端預期
            const formattedData = {
                stat: 'OK',
                title: '個股日成交資訊',
                fields: ['證券代號', '證券名稱', '成交股數', '成交筆數', '成交金額', '開盤價', '最高價', '最低價', '收盤價', '漲跌(+/-)', '漲跌價差', '最後揭示買價', '最後揭示買量', '最後揭示賣價', '最後揭示賣量', '本益比'],
                data: response.data.data.map(item => [
                    item[0],  // 證券代號
                    item[1],  // 證券名稱
                    item[2],  // 成交股數
                    item[3],  // 成交筆數
                    item[4],  // 成交金額
                    item[5],  // 開盤價
                    item[6],  // 最高價
                    item[7],  // 最低價
                    item[8],  // 收盤價
                    item[9],  // 漲跌(+/-)
                    item[10], // 漲跌價差
                    item[11], // 最後揭示買價
                    item[12], // 最後揭示買量
                    item[13], // 最後揭示賣價
                    item[14], // 最後揭示賣量
                    item[15]  // 本益比
                ])
            };
            
            return {
                data: formattedData,
                isHistoricalData: false
            };
        }
    } catch (error) {
        console.warn(`STOCK_DAY_ALL API 請求失敗:`, error.message);
    }
    
    return null;
}

// 獲取全球主要股市指數
app.get('/api/global-indices', async (req, res) => {
    const now = Date.now();
    
    // 檢查緩存是否有效
    if (indicesCache.data && (now - indicesCache.timestamp) < CACHE_DURATION) {
        return res.json({
            success: true,
            data: indicesCache.data,
            lastUpdated: new Date(indicesCache.timestamp).toISOString(),
            fromCache: true
        });
    }
    
    try {
        // 使用 yahoo-finance2 獲取所有指數的報價
        const symbols = Object.keys(INDICES);
        const quotes = await Promise.all(
            symbols.map(symbol => 
                yahooFinance.quote(symbol).catch(err => {
                    console.error(`Error fetching ${symbol}:`, err.message);
                    return null;
                })
            )
        );
        
        // 處理API響應
        const indices = [];
        
        quotes.forEach((quote, index) => {
            if (!quote) return;
            
            const symbol = symbols[index];
            const indexInfo = INDICES[symbol] || { name: symbol, symbol: symbol };
            
            let price = quote.regularMarketPrice || 0;
            let previousClose = quote.regularMarketPreviousClose || price;
            let change = price - previousClose;
            let changePercent = previousClose !== 0 ? (change / previousClose) * 100 : 0;
            
            // 格式化數值到小數點後兩位
            price = parseFloat(price.toFixed(2));
            change = parseFloat(change.toFixed(2));
            changePercent = parseFloat(changePercent.toFixed(2));
            
            indices.push({
                name: indexInfo.name,
                symbol: symbol,
                price: price,
                change: change,
                changePercent: changePercent
            });
        });
        
        // 按預定義順序排序
        const sortedIndices = Object.keys(INDICES)
            .map(symbol => indices.find(index => index.symbol === symbol))
            .filter(Boolean);
        
        // 更新緩存
        indicesCache = {
            data: sortedIndices,
            timestamp: now
        };
        
        res.json({
            success: true,
            data: indices,
            lastUpdated: new Date().toISOString(),
            fromCache: false
        });
        
    } catch (error) {
        console.error('獲取全球指數失敗:', error);
        
        // 如果緩存中有舊數據，返回緩存數據
        if (indicesCache.data) {
            console.log('返回緩存數據');
            return res.json({
                success: true,
                data: indicesCache.data,
                lastUpdated: new Date(indicesCache.timestamp).toISOString(),
                fromCache: true,
                error: '使用緩存數據: ' + error.message
            });
        }
        
        // 如果沒有緩存數據，返回錯誤
        res.status(500).json({
            success: false,
            error: '無法獲取全球指數數據',
            details: error.message
        });
    }
});

// 代理端點 - 取得股票資料
app.get('/api/stock-data', async (req, res) => {
    try {
        let currentDate = new Date();
        let dateStr = formatDate(currentDate);
        let result = null;
        let attempts = 0;
        const maxAttempts = 5; // 最多嘗試 5 天
        
        // 嘗試取得資料，如果失敗則嘗試前一個交易日
        while (attempts < maxAttempts && !result) {
            console.log(`嘗試取得 ${dateStr} 的股票資料 (嘗試 ${attempts + 1}/${maxAttempts})`);
            
            result = await fetchStockData(dateStr);
            
            if (result) {
                // 如果是舊資料，添加標記
                if (attempts > 0) {
                    result.data.isHistoricalData = true;
                    result.data.originalDate = dateStr;
                    result.data.currentDate = formatDate(new Date());
                }
                
                return res.json({
                    success: true,
                    data: result.data
                });
            }
            
            // 嘗試前一個交易日
            currentDate = getPreviousTradingDay(currentDate);
            dateStr = formatDate(currentDate);
            attempts++;
            
            // 避免頻繁請求
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // 如果所有嘗試都失敗，返回錯誤
        throw new Error(`在 ${maxAttempts} 次嘗試後仍無法取得有效的股票資料`);
    } catch (error) {
        console.error('Proxy error:', error.message);
        
        // 返回錯誤訊息
        res.status(500).json({
            success: false,
            error: '無法取得證交所資料',
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// 健康檢查端點
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 處理 404
app.use((req, res) => {
    res.status(404).json({ success: false, error: '找不到該路由' });
});

// 錯誤處理中介軟體
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        success: false,
        error: '伺服器發生錯誤',
        message: err.message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

// 設定監聽的連接埠
const PORT = process.env.PORT || 3000;

// 啟動伺服器
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 代理伺服器已啟動`);
    console.log(`🌐 網址: http://localhost:${PORT}`);
    console.log(`📊 股票資料 API: http://localhost:${PORT}/api/stock-data`);
    console.log(`🩺 健康檢查: http://localhost:${PORT}/api/health\n`);
    
    // 顯示網路介面 IP 地址
    const os = require('os');
    const interfaces = os.networkInterfaces();
    
    console.log('可用網路介面:');
    Object.keys(interfaces).forEach(ifname => {
        interfaces[ifname].forEach(iface => {
            if ('IPv4' === iface.family && !iface.internal) {
                console.log(`- ${ifname}: http://${iface.address}:${PORT}`);
            }
        });
    });
});

// 處理未捕獲的異常
process.on('uncaughtException', (error) => {
    console.error('未捕獲的異常:', error);
    // 可以選擇優雅地關閉伺服器
    // process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('未處理的 Promise 拒絕:', reason);
});

// 導出 app 用於測試
module.exports = app;
