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

// 產業代號緩存
let industryCache = {
    data: null,
    timestamp: 0
};

// ETF 資料緩存
let etfData = null;
let etfLastUpdate = 0;
let stockInfoCache = {};
let stockFinanceCache = {};
const CACHE_DURATION = 5 * 60 * 1000; // 5 分鐘快取緩存

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

// 獲取 ETF 資料
async function fetchETFData() {
    try {
        const response = await axios.get('https://openapi.twse.com.tw/v1/opendata/t187ap47_L', {
            headers: {
                'Accept': 'application/json',
                'Accept-Language': 'zh-TW',
            },
            timeout: 10000
        });
        
        // 只保留需要的欄位
        const filteredData = response.data.map(etf => ({
            code: etf['基金代號'],
            name: etf['基金名稱'],
            index: etf['標的指數|追蹤指數名稱'],
            type: etf['基金類型'],
            manager: etf['投資經理人']
        }));
        
        etfData = filteredData;
        etfLastUpdate = Date.now();
        return filteredData;
    } catch (error) {
        console.error('獲取 ETF 資料時發生錯誤:', error);
        throw new Error('無法獲取 ETF 資料');
    }
}

// 獲取股票基本資料
async function fetchStockInfo(stockId) {
    try {
        // 檢查快取
        const now = Date.now();
        if (stockInfoCache[stockId] && (now - stockInfoCache[stockId].timestamp) < CACHE_DURATION) {
            return stockInfoCache[stockId].data;
        }

        const response = await axios.get('https://openapi.twse.com.tw/v1/opendata/t187ap03_L', {
            headers: {
                'Accept': 'application/json',
                'Accept-Language': 'zh-TW',
            },
            timeout: 10000
        });
        
        // 過濾出指定股票代號的資料
        const stockData = response.data.find(item => item['公司代號'] === stockId);
        if (!stockData) {
            throw new Error('找不到該股票代號的資料');
        }
        
        // 格式化資料
        const formattedData = {
            companyName: stockData['公司名稱'],
            industry: stockData['產業別'],
            chairman: stockData['董事長'],
            establishedDate: stockData['成立日期'],
            listedDate: stockData['上市日期'],
            capital: stockData['實收資本額'],
            website: stockData['網址']
        };
        
        // 更新快取
        stockInfoCache[stockId] = {
            data: formattedData,
            timestamp: now
        };
        
        return formattedData;
    } catch (error) {
        console.error(`獲取股票 ${stockId} 基本資料時發生錯誤:`, error);
        throw new Error(`無法獲取股票 ${stockId} 的基本資料: ${error.message}`);
    }
}

// 獲取股票財務資料
async function fetchStockFinance(stockId) {
    try {
        // 檢查快取
        const now = Date.now();
        if (stockFinanceCache[stockId] && (now - stockFinanceCache[stockId].timestamp) < CACHE_DURATION) {
            return stockFinanceCache[stockId].data;
        }

        // 1. 先取得即時交易資訊
        const stockInfoResponse = await axios.get('https://mis.twse.com.tw/stock/api/getStockInfo.jsp', {
            params: { ex_ch: `tse_${stockId}.tw` },
            timeout: 10000
        });

        // 2. 取得財務指標資料 (殖利率、本益比、股價淨值比)
        const financeResponse = await axios.get('https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_d', {
            params: { response: 'json', stockNo: stockId },
            timeout: 10000
        });

        // 處理即時交易資訊
        let stockInfo = {};
        if (stockInfoResponse.data.msgArray && stockInfoResponse.data.msgArray.length > 0) {
            stockInfo = stockInfoResponse.data.msgArray[0];
        }

        // 處理財務指標資料
        let financeData = {};
        if (financeResponse.data && Array.isArray(financeResponse.data)) {
            // 根據股票代號過濾資料
            const stockFinance = financeResponse.data.find(item => item.Code === stockId);
            
            if (stockFinance) {
                financeData = {
                    dividendYield: stockFinance.DividendYield || 'N/A',
                    peRatio: stockFinance.PEratio || 'N/A',
                    pbRatio: stockFinance.PBratio || 'N/A',
                    fiscalYear: stockFinance.DividendYear || 'N/A',
                    fiscalQuarter: stockFinance.FiscalYearQuarter ? 
                        stockFinance.FiscalYearQuarter.split('Q')[1] : 'N/A',
                    fiscalYearQuarter: stockFinance.FiscalYearQuarter || 'N/A'
                };
            } else {
                console.warn(`找不到股票代號 ${stockId} 的財務資料`);
            }
        }
        
        // 格式化資料
        const formattedData = {
            // 財務指標
            dividendYield: financeData.dividendYield || 'N/A',
            peRatio: financeData.peRatio || 'N/A',
            pbRatio: financeData.pbRatio || 'N/A',
            fiscalYear: financeData.fiscalYear || 'N/A',
            fiscalQuarter: financeData.fiscalQuarter || 'N/A',
            fiscalYearQuarter: financeData.fiscalYearQuarter || 'N/A',
            
            // 即時交易資訊
            tradeVolume: stockInfo.v || 'N/A',
            tradeValue: stockInfo.f || 'N/A',
            openingPrice: stockInfo.o || 'N/A',
            highestPrice: stockInfo.h || 'N/A',
            lowestPrice: stockInfo.l || 'N/A',
            closingPrice: stockInfo.z || stockInfo.c || 'N/A',
            change: stockInfo.z ? (parseFloat(stockInfo.z) - parseFloat(stockInfo.y || 0)).toFixed(2) : 'N/A',
            changePercent: stockInfo.z && stockInfo.y ? 
                (((parseFloat(stockInfo.z) - parseFloat(stockInfo.y)) / parseFloat(stockInfo.y)) * 100).toFixed(2) + '%' : 'N/A',
            lastPrice: stockInfo.z || stockInfo.c || 'N/A',
            highPrice: stockInfo.h || 'N/A',
            lowPrice: stockInfo.l || 'N/A',
            volume: stockInfo.v || 'N/A',
            totalVolume: stockInfo.tv || 'N/A',
            openPrice: stockInfo.o || 'N/A',
            yesterdayPrice: stockInfo.y || 'N/A'
        };
        
        // 更新快取
        stockFinanceCache[stockId] = {
            data: formattedData,
            timestamp: now
        };
        
        return formattedData;
    } catch (error) {
        console.error(`獲取股票 ${stockId} 財務資料時發生錯誤:`, error);
        // 返回預設值而不是拋出錯誤
        return {
            dividendYield: 'N/A',
            peRatio: 'N/A',
            pbRatio: 'N/A',
            fiscalYear: 'N/A',
            fiscalQuarter: 'N/A',
            fiscalYearQuarter: 'N/A',
            tradeVolume: 'N/A',
            tradeValue: 'N/A',
            openingPrice: 'N/A',
            highestPrice: 'N/A',
            lowestPrice: 'N/A',
            closingPrice: 'N/A',
            change: 'N/A',
            transaction: 'N/A',
            lastPrice: 'N/A',
            changePercent: 'N/A',
            highPrice: 'N/A',
            lowPrice: 'N/A',
            volume: 'N/A',
            totalVolume: 'N/A',
            openPrice: 'N/A',
            yesterdayPrice: 'N/A'
        };
    }
}

// 獲取股票資料
async function fetchStockData(dateStr) {
    console.log(`嘗試取得 ${dateStr} 的股票資料`);
    
    // 使用 STOCK_DAY_ALL API 取得資料
    try {
        console.log('使用 STOCK_DAY_ALL API 取得資料...');
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

// 獲取 ETF 資料
app.get('/api/etf-list', async (req, res) => {
    try {
        const now = Date.now();
        // 檢查快取是否過期
        if (!etfData || (now - etfLastUpdate) > CACHE_DURATION) {
            console.log('快取過期或無快取，重新獲取 ETF 資料...');
            const data = await fetchETFData();
            res.json({
                success: true,
                data: data,
                lastUpdated: new Date(now).toISOString(),
                fromCache: false
            });
        } else {
            console.log('使用快取的 ETF 資料');
            res.json({
                success: true,
                data: etfData,
                lastUpdated: new Date(etfLastUpdate).toISOString(),
                fromCache: true
            });
        }
    } catch (error) {
        console.error('處理 ETF 資料請求時發生錯誤:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 獲取股票基本資料
app.get('/api/stock-info/:stockId', async (req, res) => {
    try {
        const { stockId } = req.params;
        if (!stockId) {
            return res.status(400).json({ success: false, error: '請提供股票代號' });
        }
        
        const data = await fetchStockInfo(stockId);
        res.json({
            success: true,
            data: data
        });
    } catch (error) {
        console.error('處理股票基本資料請求時發生錯誤:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 獲取股票財務資料
app.get('/api/stock-finance/:stockId', async (req, res) => {
    try {
        const { stockId } = req.params;
        if (!stockId) {
            return res.status(400).json({ success: false, error: '請提供股票代號' });
        }
        
        const data = await fetchStockFinance(stockId);
        res.json({
            success: true,
            data: data,
            lastUpdated: new Date().toISOString()
        });
    } catch (error) {
        console.error('處理股票財務資料請求時發生錯誤:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 獲取產業代號
app.get('/api/industries', (req, res) => {
    const now = Date.now();
    
    // 檢查緩存是否有效
    if (industryCache.data && (now - industryCache.timestamp) < CACHE_DURATION) {
        return res.json({
            success: true,
            data: industryCache.data,
            lastUpdated: new Date(industryCache.timestamp).toISOString(),
            fromCache: true,
            isSampleData: true
        });
    }
    
    // 使用預設的產業代號資料
    const sampleData = [
        { code: '01', name: '水泥工業' },
        { code: '02', name: '食品工業' },
        { code: '03', name: '塑膠工業' },
        { code: '04', name: '紡織纖維' },
        { code: '05', name: '電機機械' },
        { code: '06', name: '電器電纜' },
        { code: '08', name: '玻璃陶瓷' },
        { code: '09', name: '造紙工業' },
        { code: '10', name: '鋼鐵工業' },
        { code: '11', name: '橡膠工業' },
        { code: '12', name: '汽車工業' },
        { code: '13', name: '電子工業' },
        { code: '14', name: '建材營造業' },
        { code: '15', name: '航運業' },
        { code: '16', name: '觀光餐旅業' },
        { code: '17', name: '金融保險業' },
        { code: '18', name: '貿易百貨業' },
        { code: '19', name: '綜合' },
        { code: '20', name: '其他業' },
        { code: '21', name: '化學工業' },
        { code: '22', name: '生技醫療業' },
        { code: '23', name: '油電燃氣業' },
        { code: '24', name: '半導體業' },
        { code: '25', name: '電腦及週邊設備業' },
        { code: '26', name: '光電業' },
        { code: '27', name: '通信網路業' },
        { code: '28', name: '電子零組件業' },
        { code: '29', name: '電子通路業' },
        { code: '30', name: '資訊服務業' },
        { code: '31', name: '其他電子業' },
        { code: '32', name: '文化創意業' },
        { code: '33', name: '農業科技業' },
        { code: '34', name: '電子商務' },
        { code: '35', name: '綠能環保' },
        { code: '36', name: '數位雲端' },
        { code: '37', name: '運動休閒' },
        { code: '38', name: '居家生活' }
    ];
    
    // 更新緩存
    industryCache = {
        data: sampleData,
        timestamp: now
    };
    
    res.json({
        success: true,
        data: sampleData,
        lastUpdated: new Date().toISOString(),
        fromCache: false,
        isSampleData: true
    });
});

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

// 啟動時預先載入 ETF 資料
console.log('預先載入 ETF 資料...');
fetchETFData().catch(error => {
    console.error('預先載入 ETF 資料時發生錯誤:', error);
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
