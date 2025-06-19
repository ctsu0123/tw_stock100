// 全域變數
let stockData = [];
let allStocksData = [];

// DOM 元素
const elements = {
    fetchBtn: document.getElementById('fetchBtn'),
    exportBtn: document.getElementById('exportBtn'),
    applyFilter: document.getElementById('applyFilter'),
    resetFilter: document.getElementById('resetFilter'),
    filterType: document.getElementById('filterType'),
    filterCondition: document.getElementById('filterCondition'),
    filterValue: document.getElementById('filterValue'),
    loading: document.getElementById('loading'),
    status: document.getElementById('status'),
    stockTable: document.getElementById('stockTable'),
    stockTableBody: document.getElementById('stockTableBody')
};

// 初始化應用程式
function init() {
    // 初始化事件監聽器
    elements.fetchBtn.addEventListener('click', fetchStockData);
    elements.exportBtn.addEventListener('click', exportToExcel);
    elements.applyFilter.addEventListener('click', filterStocks);
    elements.resetFilter.addEventListener('click', resetFilter);
    
    // 輸入框按 Enter 鍵觸發篩選
    elements.filterValue.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            filterStocks();
        }
    });
    
    // 根據篩選類型切換條件選項
    elements.filterType.addEventListener('change', function() {
        const filterType = this.value;
        const conditionSelect = elements.filterCondition;
        
        if (filterType === 'name') {
            // 文字搜尋只保留「包含」選項
            Array.from(conditionSelect.options).forEach(option => {
                option.style.display = option.value === 'contains' ? '' : 'none';
            });
            conditionSelect.value = 'contains';
            elements.filterValue.placeholder = '輸入股票代碼或名稱';
        } else {
            // 數值比較選項
            Array.from(conditionSelect.options).forEach(option => {
                option.style.display = option.value === 'contains' ? 'none' : '';
            });
            conditionSelect.value = 'greater';
            elements.filterValue.placeholder = '輸入數值';
        }
    });
    
    // 初始化篩選條件
    elements.filterType.dispatchEvent(new Event('change'));
    
    // 自動取得資料
    fetchStockData();
}

// 使用後端 API 取得台灣股票資料
async function fetchRealStockData() {
    try {
        showStatus('正在從後端伺服器取得即時股票資料...');
        console.log('正在向後端發送請求...');
        
        const response = await fetch('http://localhost:3000/api/stock-data');
        console.log('收到後端回應，狀態碼:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('後端請求失敗，回應內容:', errorText);
            throw new Error(`後端請求失敗: ${response.status} ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log('後端返回的資料結構:', Object.keys(result));
        
        if (!result.success) {
            console.error('後端返回錯誤:', result.error || '未知錯誤');
            throw new Error(result.error || '後端服務發生錯誤');
        }
        
        console.log('後端返回的資料:', result.data);
        
        // 檢查是否有有效的資料
        if (!result.data) {
            console.error('後端返回的資料中缺少 data 欄位:', result);
            throw new Error('後端返回的資料格式不正確');
        }
        
        let processedData = [];
        
        // 檢查資料格式並進行相應處理
        if (result.data.data9) {
            // MI_INDEX 格式
            console.log('處理 MI_INDEX 格式的資料，筆數:', result.data.data9.length);
            processedData = processTWSEData(result.data.data9);
        } else if (result.data.data && Array.isArray(result.data.data)) {
            // STOCK_DAY_ALL 格式
            console.log('處理 STOCK_DAY_ALL 格式的資料，筆數:', result.data.data.length);
            processedData = processStockDayAllData(result.data.data);
        } else {
            // 嘗試直接處理資料（可能是已經處理過的格式）
            console.log('嘗試直接處理資料...');
            processedData = result.data;
            
            // 如果資料格式不符合預期，拋出錯誤
            if (!Array.isArray(processedData) || processedData.length === 0) {
                throw new Error('無法識別的資料格式');
            }
            
            // 確保資料有基本欄位
            const firstItem = processedData[0];
            if (!firstItem.code || !firstItem.name) {
                throw new Error('無效的資料格式：缺少必要欄位');
            }
            
            // 添加排名
            processedData = processedData
                .filter(item => item.volume > 0)
                .sort((a, b) => b.volume - a.volume)
                .slice(0, 500)  // 改為顯示前500名
                .map((item, index) => ({
                    ...item,
                    rank: index + 1
                }));
        }
        
        console.log('處理後的股票資料筆數:', processedData.length);
        
        if (processedData.length === 0) {
            console.warn('處理後沒有取得任何有效的股票資料');
            throw new Error('沒有取得任何有效的股票資料');
        }
        
        console.log('成功從後端伺服器取得股票資料', processedData);
        showStatus(`已成功取得 ${processedData.length} 筆股票資料`, false);
        return processedData;
        
    } catch (error) {
        console.error('取得股票資料時發生錯誤:', error);
        showStatus(`錯誤: ${error.message}. 將使用示範資料。`, true);
        showDemoWarning();
        return generateDemoData();
    }
}

// 顯示示範資料警告
function showDemoWarning() {
    const demoWarning = document.createElement('div');
    demoWarning.className = 'demo-warning';
    demoWarning.innerHTML = `
        <div style="background: #fff3cd; color: #856404; padding: 10px; border-radius: 5px; border: 1px solid #ffeeba; margin: 10px 0;">
            ⚠️ <strong>目前使用示範資料</strong><br>
            <small>這些資料僅供展示功能使用，<strong>非即時真實交易資料</strong>，請勿用於實際投資決策。</small>
        </div>
    `;
    elements.status.insertAdjacentElement('afterend', demoWarning);
}

// 處理證交所 MI_INDEX 格式資料
function processTWSEData(data) {
    if (!data || !Array.isArray(data)) {
        console.error('無效的 MI_INDEX 資料格式:', data);
        return [];
    }
    
    console.log('開始處理 MI_INDEX 資料，原始資料筆數:', data.length);
    
    // 在 MI_INDEX 格式中，交易筆數可能在 item[3] 或 item[4] 位置，視實際資料結構調整
    // 這裡假設交易筆數在 item[3]
    const TRANSACTION_INDEX = 3;
    
    return data
        .filter(item => item && item.length >= 16)
        .map(item => {
            const transaction = item[TRANSACTION_INDEX] 
                ? parseInt(item[TRANSACTION_INDEX].replace(/,/g, '') || '0')
                : 0;
                
            return {
                code: item[0],
                name: item[1],
                volume: parseInt(item[2]?.replace(/,/g, '') || '0'),
                price: parseFloat(item[8] || '0'),
                change: parseFloat(item[9] || '0'),
                changePercent: parseFloat(item[10] || '0'),
                open: parseFloat(item[5] || '0'),
                high: parseFloat(item[6] || '0'),
                low: parseFloat(item[7] || '0'),
                previousClose: parseFloat(item[8] || '0') - parseFloat(item[9] || '0'),
                transaction: transaction,
                _raw: item
            };
        })
        .filter(item => item.volume > 0)
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 500)  // 改為顯示前500名
        .map((item, index) => ({
            ...item,
            rank: index + 1
        }));
}

// 處理 STOCK_DAY_ALL 格式資料
function processStockDayAllData(data) {
    console.log('原始資料範例:', data[0]);
    
    if (!data || !Array.isArray(data)) {
        console.error('無效的 STOCK_DAY_ALL 資料格式:', data);
        return [];
    }
    
    console.log('開始處理 STOCK_DAY_ALL 資料，原始資料筆數:', data.length);
    
    // 處理陣列格式的資料
    const processedData = data
        .filter(item => item && item.length >= 10) // 至少需要 10 個欄位
        .map(item => {
            try {
                // 根據實際資料格式解析欄位
                const [
                    code,           // 證券代號
                    name,           // 證券名稱
                    tradeVolume,    // 成交股數
                    tradeValue,     // 成交金額
                    openPrice,      // 開盤價
                    highestPrice,   // 最高價
                    lowestPrice,    // 最低價
                    closePrice,     // 收盤價
                    change,         // 漲跌價差
                    transaction,    // 成交筆數
                    ...rest
                ] = item;
                
                // 轉換數值
                const volume = typeof tradeVolume === 'string' 
                    ? parseInt(tradeVolume.replace(/,/g, '') || '0') 
                    : tradeVolume || 0;
                    
                const price = typeof closePrice === 'string' 
                    ? parseFloat(closePrice.replace(/,/g, '')) 
                    : closePrice || 0;
                    
                const changeValue = typeof change === 'string'
                    ? parseFloat(change.replace(/,/g, '')) || 0
                    : change || 0;
                    
                const previousClose = price - changeValue;
                
                // 計算漲跌幅（%）
                let changePercent = 0;
                if (previousClose > 0) {
                    changePercent = (changeValue / previousClose) * 100;
                }
                
                return {
                    code: code || '',
                    name: name ? name.trim() : '',
                    volume: Math.floor(volume / 1000), // 轉換為張數
                    price: price,
                    change: changeValue,
                    changePercent: changePercent,
                    open: typeof openPrice === 'string' 
                        ? parseFloat(openPrice.replace(/,/g, '')) 
                        : openPrice || 0,
                    high: typeof highestPrice === 'string' 
                        ? parseFloat(highestPrice.replace(/,/g, '')) 
                        : highestPrice || 0,
                    low: typeof lowestPrice === 'string' 
                        ? parseFloat(lowestPrice.replace(/,/g, '')) 
                        : lowestPrice || 0,
                    previousClose: previousClose,
                    transaction: typeof transaction === 'string'
                        ? parseInt(transaction.replace(/,/g, '') || '0')
                        : transaction || 0,
                    _raw: item
                };
            } catch (error) {
                console.error('處理股票資料時發生錯誤:', error, item);
                return null;
            }
        })
        .filter(item => item && item.code && item.volume > 0); // 過濾無效資料
    
    console.log('處理後的資料筆數:', processedData.length);
    console.log('處理後的資料範例:', processedData[0]);
    
    // 排序並限制筆數
    return processedData
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 500)  // 改為顯示前500名
        .map((item, index) => ({
            ...item,
            rank: index + 1
        }));
}

// 生成示範資料（當API無法存取時使用）
function generateDemoData() {
    const realStocks = [
        { code: '2330', name: '台積電', basePrice: 580, baseVolume: 50000000 },
        { code: '2317', name: '鴻海', basePrice: 105, baseVolume: 45000000 },
        { code: '2454', name: '聯發科', basePrice: 920, baseVolume: 4000000 },
        { code: '2412', name: '中華電', basePrice: 128, baseVolume: 3500000 },
        { code: '2881', name: '富邦金', basePrice: 62, baseVolume: 3000000 },
        { code: '2882', name: '國泰金', basePrice: 45.5, baseVolume: 2800000 },
        { code: '1303', name: '南亞', basePrice: 78.5, baseVolume: 2500000 },
        { code: '2002', name: '中鋼', basePrice: 38.3, baseVolume: 2300000 },
        { code: '1301', name: '台塑', basePrice: 102, baseVolume: 2200000 },
        { code: '2303', name: '聯電', basePrice: 51.2, baseVolume: 2000000 }
    ];

    // 生成隨機變化的資料
    return realStocks.map((stock, index) => {
        // 隨機變動價格（±5%）
        const priceVariation = (Math.random() * 10 - 5) / 100;
        const price = stock.basePrice * (1 + priceVariation);
        
        // 隨機變動成交量（±20%）
        const volumeVariation = (Math.random() * 40 - 20) / 100;
        const volume = Math.floor(stock.baseVolume * (1 + volumeVariation));
        
        // 隨機漲跌（±3%）
        const changePercent = (Math.random() * 6 - 3);
        const change = (price * changePercent / 100);
        
        return {
            code: stock.code,
            name: stock.name,
            volume: Math.floor(volume / 1000), // 轉換為張數
            price: parseFloat(price.toFixed(2)),
            change: parseFloat(change.toFixed(2)),
            changePercent: parseFloat(changePercent.toFixed(2)),
            open: parseFloat((price * (1 + (Math.random() * 2 - 1) / 100)).toFixed(2)),
            high: parseFloat((price * (1 + Math.random() * 0.02)).toFixed(2)),
            low: parseFloat((price * (1 - Math.random() * 0.02)).toFixed(2)),
            previousClose: parseFloat((price - change).toFixed(2)),
            transaction: Math.floor(volume / 1000 * (0.8 + Math.random() * 0.4)), // 模擬成交筆數
            rank: index + 1
        };
    });
}

// 格式化數字（加上千分位逗號）
function formatNumber(num) {
    if (num === undefined || num === null) return '0';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// 格式化成交量（轉換為張數）
function formatVolume(volume) {
    return formatNumber(volume);
}

// 取得漲跌類別（用於設定 CSS 類別）
function getChangeClass(change) {
    if (change > 0) return 'positive';
    if (change < 0) return 'negative';
    return 'neutral';
}

// 渲染表格
function renderTable(data) {
    const tbody = elements.stockTableBody;
    tbody.innerHTML = '';
    
    data.forEach(stock => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="rank">${stock.rank}</td>
            <td><a href="stock-detail.html?id=${stock.code}" class="stock-code-link">${stock.code}</a></td>
            <td>${stock.name}</td>
            <td class="volume">${formatVolume(stock.volume)}</td>
            <td>$${stock.price.toFixed(2)}</td>
            <td class="${getChangeClass(stock.change)}">${stock.change > 0 ? '+' : ''}${stock.change.toFixed(2)}</td>
            <td class="${getChangeClass(stock.changePercent)}">${stock.changePercent > 0 ? '+' : ''}${stock.changePercent.toFixed(2)}%</td>
            <td>$${stock.open.toFixed(2)}</td>
            <td>$${stock.high.toFixed(2)}</td>
            <td>$${stock.low.toFixed(2)}</td>
            <td>$${stock.previousClose.toFixed(2)}</td>
        `;
        tbody.appendChild(row);
    });
}

// 顯示載中狀態
function showLoading() {
    elements.loading.style.display = 'block';
    elements.status.style.display = 'none';
    elements.stockTable.style.display = 'none';
    elements.fetchBtn.disabled = true;
}

// 隱藏載入狀態
function hideLoading() {
    elements.loading.style.display = 'none';
    elements.fetchBtn.disabled = false;
}

// 顯示表格
function showTable() {
    elements.stockTable.style.display = 'table';
    elements.exportBtn.disabled = false;
    elements.status.style.display = 'none';
}

// 顯示狀態訊息
function showStatus(message, isError = false) {
    const statusDiv = elements.status;
    statusDiv.innerHTML = isError ? `<div class="error">${message}</div>` : message;
    statusDiv.style.display = 'block';
}

// 取得股票資料
async function fetchStockData() {
    showLoading();
    
    try {
        // 取得股票資料（優先使用真實API，失敗時使用示範資料）
        stockData = await fetchRealStockData();
        
        if (stockData.length === 0) {
            throw new Error('未取得任何股票資料');
        }
        
        hideLoading();
        renderTableWithData(stockData);
        showTable();
        
        // 判斷是否為示範資料
        const isDemoData = stockData.some(item => item.name.includes('股票'));
        let statusMessage;
        
        if (isDemoData) {
            statusMessage = `
                <div style="background: #fff3cd; color: #856404; padding: 10px; border-radius: 5px; border: 1px solid #ffeeba;">
                    ⚠️ <strong>目前使用示範資料</strong> (共 ${stockData.length} 檔)<br>
                    <small>這些資料僅供展示功能使用，<strong>非即時真實交易資料</strong>，請勿用於實際投資決策。</small>
                </div>
            `;
        } else {
            statusMessage = `
                <div style="background: #d4edda; color: #155724; padding: 10px; border-radius: 5px; border: 1px solid #c3e6cb;">
                    ✅ 成功取得證交所即時資料 ${stockData.length} 檔股票<br>
                    <small>更新時間: ${new Date().toLocaleString('zh-TW')}</small>
                </div>
            `;
        }
        
        showStatus(statusMessage);
        
    } catch (error) {
        hideLoading();
        showStatus(`❌ ${error.message}`, true);
        console.error('Error fetching stock data:', error);
    }
}

// 匯出到 Excel
function exportToExcel() {
    if (stockData.length === 0) {
        alert('沒有資料可匯出！');
        return;
    }
    
    try {
        // 準備資料
        const exportData = [
            ['排名', '股票代碼', '股票名稱', '成交量(張)', '成交價', '漲跌', '漲跌幅(%)', '開盤', '最高', '最低', '昨收'],
            ...stockData.map(item => [
                item.rank,
                item.code,
                item.name,
                item.volume,
                item.price,
                item.change,
                item.changePercent,
                item.open,
                item.high,
                item.low,
                item.previousClose
            ])
        ];
        
        // 建立工作簿
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(exportData);
        
        // 設定欄位寬度
        const wscols = [
            { wch: 8 },  // 排名
            { wch: 10 }, // 股票代碼
            { wch: 12 }, // 股票名稱
            { wch: 12 }, // 成交量
            { wch: 10 }, // 成交價
            { wch: 10 }, // 漲跌
            { wch: 12 }, // 漲跌幅
            { wch: 10 }, // 開盤
            { wch: 10 }, // 最高
            { wch: 10 }, // 最低
            { wch: 10 }  // 昨收
        ];
        ws['!cols'] = wscols;
        
        // 加入工作簿
        XLSX.utils.book_append_sheet(wb, ws, '股票成交量排行');
        
        // 產生檔案並下載
        const dateStr = new Date().toISOString().split('T')[0];
        const fileName = `台灣股票成交量排行_${dateStr}.xlsx`;
        XLSX.writeFile(wb, fileName);
    } catch (error) {
        console.error('匯出 Excel 時發生錯誤:', error);
        alert('匯出 Excel 時發生錯誤: ' + error.message);
    }
}

// 篩選股票資料
function filterStocks() {
    const filterType = elements.filterType.value;
    const condition = elements.filterCondition.value;
    const value = elements.filterValue.value.trim();
    
    // 如果沒有輸入值，顯示所有資料
    if (!value) {
        renderTable(allStocksData);
        return;
    }
    
    // 過濾資料
    const filteredData = allStocksData.filter(stock => {
        try {
            // 處理文字搜尋（股票代碼或名稱）
            if (filterType === 'name') {
                const searchText = value.toLowerCase();
                return condition === 'contains' 
                    ? (stock.code.toLowerCase().includes(searchText) || 
                       stock.name.toLowerCase().includes(searchText))
                    : false;
            }
            
            // 處理數值比較
            const stockValue = {
                'volume': stock.volume,
                'price': stock.price,
                'change': stock.changePercent,
                'transaction': stock.transaction || 0
            }[filterType];
            
            const numValue = parseFloat(value.replace(/,/g, ''));
            
            if (isNaN(numValue)) return false;
            
            switch(condition) {
                case 'greater': return stockValue > numValue;
                case 'less': return stockValue < numValue;
                case 'equal': return Math.abs(stockValue - numValue) < 0.01; // 考慮浮點數誤差
                default: return false;
            }
        } catch (error) {
            console.error('篩選資料時發生錯誤:', error);
            return false;
        }
    });
    
    // 重新渲染表格
    renderTable(filteredData);
}

// 重設篩選
function resetFilter() {
    elements.filterType.value = 'volume';
    elements.filterCondition.value = 'greater';
    elements.filterValue.value = '';
    renderTable(allStocksData);
}

// 更新表格渲染函數，儲存原始資料
function renderTableWithData(data) {
    allStocksData = [...data]; // 儲存原始資料的副本
    renderTable(data);
}

// 獲取全球主要股市指數
async function fetchGlobalIndices() {
    const container = document.getElementById('globalIndices');
    
    try {
        const response = await fetch('http://localhost:3000/api/global-indices');
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error || '無法獲取全球指數數據');
        }
        
        // 創建跑馬燈容器（如果不存在）
        let ticker = container.querySelector('.ticker');
        if (!ticker) {
            container.innerHTML = `
                <div class="ticker">
                    <div class="ticker-wrapper">
                        <ul class="ticker-list"></ul>
                    </div>
                </div>
            `;
            ticker = container.querySelector('.ticker');
        }
        
        const tickerWrapper = ticker.querySelector('.ticker-wrapper');
        const tickerList = tickerWrapper.querySelector('.ticker-list');
        
        // 清空現有內容
        tickerList.innerHTML = '';
        
        // 創建跑馬燈項目（創建兩份以實現無縫循環）
        for (let i = 0; i < 2; i++) {
            result.data.forEach(index => {
                const isPositive = index.change >= 0;
                const changeSign = isPositive ? '+' : '';
                const arrow = isPositive ? '▲' : '▼';
                
                const listItem = document.createElement('li');
                listItem.className = `ticker-item ${isPositive ? 'positive' : 'negative'}`;
                listItem.innerHTML = `
                    <span class="ticker-name">${index.name}</span>
                    <span class="ticker-price">${index.price.toLocaleString()}</span>
                    <span class="ticker-change">
                        <span>${changeSign}${index.change} (${changeSign}${index.changePercent}%)</span>
                        <span class="ticker-arrow">${arrow}</span>
                    </span>
                `;
                
                tickerList.appendChild(listItem);
            });
        }
        
        // 每5分鐘更新一次數據
        setTimeout(fetchGlobalIndices, 5 * 60 * 1000);
        
    } catch (error) {
        console.error('獲取全球指數失敗:', error);
        container.innerHTML = `
            <div class="error-message" style="text-align: center; color: #e74c3c; padding: 10px;">
                ❌ 無法載入全球指數數據，請稍後再試
            </div>
        `;
    }
}

// 初始化應用程式
document.addEventListener('DOMContentLoaded', () => {
    init();
    fetchGlobalIndices(); // 載入全球指數數據
});
