document.addEventListener('DOMContentLoaded', () => {
    // ==========================================
    // 1. ИНИЦИАЛИЗАЦИЯ И БУФЕР ДАННЫХ (МАШИНА ВРЕМЕНИ)
    // ==========================================
    const chartDom = document.getElementById('main-chart');
    const myChart = echarts.init(chartDom);
    
    let fullTime = []; let fullSpeed = []; let fullTemp = []; let fullPredict = []; 
    const WINDOW_SIZE = 50; 
    
    let now = new Date();
    for (let i = 0; i < 300; i++) {
        fullTime.push([now.getHours(), now.getMinutes(), now.getSeconds()].join(':'));
        fullSpeed.push(Math.floor(Math.random() * 5) + 75); 
        fullTemp.push(Math.floor(Math.random() * 3) + 85);   
        fullPredict.push(null);
        now = new Date(now.getTime() - 1000);
    }
    fullTime.reverse(); fullSpeed.reverse(); fullTemp.reverse(); fullPredict.reverse();

    let viewEnd = fullTime.length; 

    const getOption = () => ({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', backgroundColor: 'rgba(10, 11, 14, 0.9)', borderColor: '#444', textStyle: { color: '#fff' } },
        legend: { data: ['Скорость', 'Температура', 'Прогноз (AI)'], textStyle: { color: '#a1a1aa' } },
        grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
        xAxis: { type: 'category', boundaryGap: false, data: [], axisLabel: { color: '#a1a1aa' } },
        yAxis: [
            { type: 'value', name: 'Скорость', position: 'left', splitLine: { lineStyle: { color: '#222' } }, axisLabel: { color: '#a1a1aa' } },
            { type: 'value', name: 'Темп.', position: 'right', max: 130, splitLine: { show: false }, axisLabel: { color: '#a1a1aa' } }
        ],
        visualMap: {
            show: false, seriesIndex: 1,
            pieces: [{ gt: 0, lte: 95, color: '#00e676' }, { gt: 95, lte: 105, color: '#eab308' }, { gt: 105, color: '#ef4444' }]
        },
        series: [
            { name: 'Скорость', type: 'line', smooth: true, itemStyle: { color: '#00A3E0' }, data: [] },
            { 
                name: 'Температура', type: 'line', smooth: true, yAxisIndex: 1, data: [],
                markLine: { silent: true, data: [ { yAxis: 95, lineStyle: { color: '#eab308', type: 'dashed' } }, { yAxis: 105, lineStyle: { color: '#ef4444', type: 'solid' } } ] },
                markPoint: { data: window.chartAnomalyMarker ? [window.chartAnomalyMarker] : [] }
            },
            { name: 'Прогноз (AI)', type: 'line', smooth: true, yAxisIndex: 1, itemStyle: { color: '#ef4444' }, lineStyle: { type: 'dashed', width: 2 }, data: [] }
        ]
    });
    myChart.setOption(getOption());

    // ==========================================
    // 2. ИНТЕРАКТИВНЫЕ УЗЛЫ И КНОПКА СБРОСА ФИЛЬТРА
    // ==========================================
    const factorsContainer = document.getElementById('factors-container');
    let activeCategory = null; 
    let isFailureMode = false;

    const defaultFactors = [
        { name: "Температура ТЭД-1", val: "99%", color: "var(--status-norm)", w: "99%", category: "engine" },
        { name: "Давление магистрали", val: "98%", color: "var(--status-norm)", w: "98%", category: "brakes" },
        { name: "Напряжение конт. сети", val: "100%", color: "var(--status-norm)", w: "100%", category: "power" },
        { name: "Тормозные цилиндры", val: "97%", color: "var(--status-norm)", w: "97%", category: "brakes" },
        { name: "Уровень вибрации", val: "99%", color: "var(--status-norm)", w: "99%", category: "engine" }
    ];

    const criticalFactors = [
        { name: "Температура ТЭД-1 (Отказ)", val: "-20 балл.", color: "var(--status-crit)", w: "80%", detail: "<strong>Формула:</strong> Штраф за превышение 105°C.", category: "engine" },
        { name: "Давление ТМ (Утечка)", val: "-10 балл.", color: "var(--status-warn)", w: "50%", detail: "<strong>Формула:</strong> Динамика падения > 0.1 атм/мин.", category: "brakes" },
        { name: "Вибрация (Ось 2)", val: "-6 балл.", color: "var(--status-warn)", w: "30%", detail: "<strong>Формула:</strong> Отклонение гармоник.", category: "engine" },
        { name: "Напряжение сети", val: "Норма", color: "var(--text-muted)", w: "92%", category: "power" },
        { name: "Тормозные цилиндры", val: "Норма", color: "var(--text-muted)", w: "95%", category: "brakes" }
    ];

    function renderFactors(factors) {
        let filtered = activeCategory ? factors.filter(f => f.category === activeCategory) : factors;
        
        let html = '';
        if (activeCategory) {
            html += `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 15px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px;">
                    <span style="color:var(--ktz-blue); font-size:0.85rem; font-weight:bold; text-transform:uppercase;">Фокус: ${activeCategory}</span>
                    <button id="reset-filter-btn" class="action-btn" style="background:rgba(0,163,224,0.15); color:var(--ktz-blue); border: 1px solid var(--ktz-blue);">🔄 Все узлы</button>
                </div>
            `;
        }

        html += filtered.map(f => `
            <div class="factor-item" style="animation: fadeIn 0.3s ease;">
                <div class="factor-header">
                    <span style="color: ${f.color === 'var(--status-crit)' ? f.color : 'var(--text-main)'}">${f.name}</span>
                    <span style="color: ${f.color}">${f.val}</span>
                </div>
                ${f.detail ? `<div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:6px;">${f.detail}</div>` : ''}
                <div class="factor-bar"><div class="factor-fill" style="width: ${f.w}; background: ${f.color};"></div></div>
            </div>
        `).join('');

        factorsContainer.innerHTML = html;

        if (activeCategory) {
            document.getElementById('reset-filter-btn').addEventListener('click', () => {
                activeCategory = null;
                Object.values(nodes).forEach(n => { n.style.opacity = '1'; n.style.boxShadow = 'none'; });
                document.querySelector('.chart-widget h2').innerText = 'Телеметрия: Скорость и Температура';
                renderFactors(isFailureMode ? criticalFactors : defaultFactors);
            });
        }
    }
    renderFactors(defaultFactors);

    const nodes = {
        'power': document.getElementById('node-power'),
        'engine': document.getElementById('node-engine'),
        'brakes': document.getElementById('node-brakes')
    };

    Object.keys(nodes).forEach(category => {
        nodes[category].addEventListener('click', () => {
            activeCategory = category;
            Object.entries(nodes).forEach(([key, node]) => {
                if (key === category) {
                    node.style.opacity = '1'; node.style.boxShadow = '0 0 15px rgba(255,255,255,0.3)';
                } else {
                    node.style.opacity = '0.3'; node.style.boxShadow = 'none';
                }
            });
            const titles = { 'power': 'Телеметрия: Питание (Фокус)', 'engine': 'Телеметрия: Двигатель (Фокус)', 'brakes': 'Телеметрия: Тормоза (Фокус)' };
            document.querySelector('.chart-widget h2').innerText = titles[category];
            renderFactors(isFailureMode ? criticalFactors : defaultFactors);
        });
    });

    // ==========================================
    // 3. ПЛЕЕР МАШИНЫ ВРЕМЕНИ (REPLAY)
    // ==========================================
    let isPaused = false;
    const playPauseBtn = document.getElementById('play-pause');
    const replayBtn = document.querySelector('.replay-controls .action-btn'); 
    const slider = document.querySelector('.timeline-slider');
    const timelineStatus = document.getElementById('timeline-status');
    const liveBadge = document.getElementById('chart-live-badge');

    slider.min = WINDOW_SIZE;
    slider.max = fullTime.length;
    slider.value = viewEnd;

    function updateChartView() {
        const isLive = (viewEnd === fullTime.length && !isPaused);
        const curTime = fullTime.slice(viewEnd - WINDOW_SIZE, viewEnd);
        const curSpeed = fullSpeed.slice(viewEnd - WINDOW_SIZE, viewEnd);
        const curTemp = fullTemp.slice(viewEnd - WINDOW_SIZE, viewEnd);
        const curPredict = fullPredict.slice(viewEnd - WINDOW_SIZE, viewEnd);

        myChart.setOption({
            xAxis: { data: curTime },
            visualMap: { 
                show: false, seriesIndex: 1, 
                pieces: isLive ? [{ gt: 0, lte: 95, color: '#00e676' }, { gt: 95, lte: 105, color: '#eab308' }, { gt: 105, color: '#ef4444' }] : [{ gt: 0, color: '#8e8e93' }] 
            },
            series: [
                { data: curSpeed, itemStyle: { color: isLive ? '#00A3E0' : '#8e8e93' } },
                { data: curTemp },
                { data: curPredict, lineStyle: { opacity: isLive ? 1 : 0 } }
            ]
        });

        if (isLive) {
            timelineStatus.innerText = 'LIVE'; timelineStatus.style.color = 'var(--status-norm)';
            liveBadge.innerText = 'LIVE'; liveBadge.style.color = 'var(--status-crit)';
            slider.value = viewEnd;
        } else {
            const secsAgo = fullTime.length - viewEnd;
            timelineStatus.innerText = `HISTORY: -${secsAgo}s`; timelineStatus.style.color = 'var(--status-warn)';
            liveBadge.innerText = isPaused ? 'PAUSED' : 'REPLAY'; liveBadge.style.color = 'var(--text-muted)';
        }
    }

    playPauseBtn.addEventListener('click', () => {
        isPaused = !isPaused;
        playPauseBtn.innerText = isPaused ? '▶ Play' : '⏸ Pause';
        updateChartView();
    });

    replayBtn.addEventListener('click', () => {
        isPaused = true;
        playPauseBtn.innerText = '▶ Play';
        viewEnd = Math.max(WINDOW_SIZE, fullTime.length - 300);
        slider.value = viewEnd;
        updateChartView();
    });

    slider.addEventListener('input', (e) => {
        isPaused = true;
        playPauseBtn.innerText = '▶ Play';
        viewEnd = parseInt(e.target.value);
        updateChartView();
    });

    // ==========================================
    // 4. ГЕНЕРАТОР ДАННЫХ (ФОНОВЫЙ ПОТОК)
    // ==========================================
    let updateIntervalId;
    let updateSpeed = 1000;
    let isOffline = false;

    function fetchTelemetry() {
        if (isOffline) return; 

        const currentTime = new Date();
        const timeStr = [currentTime.getHours(), currentTime.getMinutes(), currentTime.getSeconds()].join(':');
        
        let newSpeed = Math.floor(Math.random() * 5) + 75;
        let newTemp = Math.floor(Math.random() * 3) + 85;
        let newPredict = null;

        if (isFailureMode) {
            newSpeed = Math.floor(Math.random() * 10) + 40; 
            newTemp = 106 + Math.floor(Math.random() * 5);  
            newPredict = newTemp + 5; 
        }

        fullTime.push(timeStr); fullSpeed.push(newSpeed); fullTemp.push(newTemp); fullPredict.push(newPredict);

        if (fullTime.length > 1000) {
            fullTime.shift(); fullSpeed.shift(); fullTemp.shift(); fullPredict.shift();
            if (viewEnd > WINDOW_SIZE) viewEnd--; 
        }

        slider.max = fullTime.length;

        if (!isPaused) {
            if (viewEnd < fullTime.length) {
                viewEnd++; 
            } else {
                viewEnd = fullTime.length; 
                slider.value = viewEnd;
            }
        }

        updateChartView();

        if(!isFailureMode && !isPaused && viewEnd === fullTime.length) {
            let currentMapProgress = parseFloat(document.getElementById('route-progress').style.width) || 65;
            if(currentMapProgress < 74) {
                currentMapProgress += 0.1;
                document.getElementById('route-progress').style.width = currentMapProgress + '%';
                document.getElementById('train-marker').style.left = currentMapProgress + '%';
            }
        }
    }
    updateIntervalId = setInterval(fetchTelemetry, updateSpeed);

    // ==========================================
    // 5. КНОПКИ ДЕМО (АВАРИЯ, НАГРУЗКА И СЕТЬ)
    // ==========================================
    const highloadBtn = document.getElementById('highload-btn');
    highloadBtn.addEventListener('click', () => {
        clearInterval(updateIntervalId);
        if (updateSpeed === 1000) {
            updateSpeed = 100; highloadBtn.innerText = "🛑 Stop Highload"; highloadBtn.style.background = "rgba(0, 163, 224, 0.2)";
        } else {
            updateSpeed = 1000; highloadBtn.innerText = "🚀 x10 Load"; highloadBtn.style.background = "transparent";
        }
        updateIntervalId = setInterval(fetchTelemetry, updateSpeed);
    });

    const failureBtn = document.getElementById('simulate-failure-btn');
    failureBtn.addEventListener('click', () => {
        isFailureMode = true;
        document.body.classList.add('critical-mode');
        
        document.getElementById('health-score').innerText = '64';
        document.getElementById('health-score').style.color = 'var(--status-crit)';
        document.getElementById('health-status').innerHTML = 'Состояние: КРИТИЧНО <span style="color:var(--status-crit); font-weight:bold;">(Риск: ВЫСОКИЙ)</span>';
        
        renderFactors(criticalFactors);

        document.getElementById('node-engine').className = 'schema-node status-crit';
        document.getElementById('node-engine').innerText = '🔥 Двигатель (Отказ)';

        window.chartAnomalyMarker = { 
            coord: [fullTime[fullTime.length - 1], fullTemp[fullTemp.length - 1]], 
            value: 'OVERHEAT', 
            itemStyle: { color: '#ef4444' },
            label: { show: true, position: 'top', backgroundColor: '#ef4444', color: '#fff', padding: [4, 8], borderRadius: 4, fontWeight: 'bold' }
        };

        const alertBox = document.getElementById('dynamic-alert');
        alertBox.className = 'alert-card critical';
        alertBox.innerHTML = `
            <span class="alert-icon">🚨</span>
            <div class="alert-content">
                <strong style="color: var(--status-crit); font-size: 1.1rem; text-transform: uppercase;">Критический перегрев ТЭД-1</strong>
                <p style="color: var(--text-main); margin: 8px 0; font-size: 0.9rem;">Температура превысила 105°C. Прогноз: возгорание через 4 мин.</p>
            </div>
        `;
        failureBtn.innerText = 'System Failed'; failureBtn.disabled = true;
    });

    const networkToggle = document.getElementById('network-toggle');
    networkToggle.addEventListener('click', () => {
        isOffline = !isOffline;
        const ping = document.getElementById('ping-indicator'); const sync = document.getElementById('sync-indicator');
        
        if (isOffline) {
            ping.innerText = "🔴 Disconnected"; ping.style.color = "var(--status-crit)";
            sync.innerText = "Connection lost..."; networkToggle.style.background = "rgba(239, 68, 68, 0.1)";
            document.querySelector('.dashboard-grid').classList.add('offline-mode');
        } else {
            ping.innerText = "🟡 Reconnecting..."; ping.style.color = "var(--status-warn)";
            setTimeout(() => {
                ping.innerText = "🟢 12ms"; ping.style.color = "var(--status-norm)";
                sync.innerText = "Sync: 0.1s ago"; networkToggle.style.background = "transparent";
                document.querySelector('.dashboard-grid').classList.remove('offline-mode');
            }, 1500);
        }
    });

    // ==========================================
    // 6. ЭКСПОРТ (PDF / CSV)
    // ==========================================
    const exportDropdownBtn = document.getElementById('export-dropdown-btn');
    const exportCsvBtn = document.getElementById('export-csv');
    const exportPdfBtn = document.getElementById('export-pdf');

    exportDropdownBtn.addEventListener('click', (e) => { 
        e.stopPropagation(); 
        exportDropdownBtn.parentElement.classList.toggle('show'); 
    });
    
    window.addEventListener('click', () => { 
        if (exportDropdownBtn.parentElement.classList.contains('show')) {
            exportDropdownBtn.parentElement.classList.remove('show'); 
        }
    });

    function getExportData() {
        let data = [];
        for (let i = 0; i < fullTime.length; i++) {
            let status = fullTemp[i] >= 105 ? "CRITICAL" : (fullTemp[i] >= 95 ? "WARNING" : "NORMAL");
            data.push([fullTime[i], fullSpeed[i], fullTemp[i], status]);
        }
        return data;
    }

    function showExportSuccess() {
        const origText = exportDropdownBtn.innerText;
        exportDropdownBtn.innerHTML = "✅ Сохранено"; 
        exportDropdownBtn.style.background = "#00e676"; 
        exportDropdownBtn.style.color = "#000";
        setTimeout(() => { 
            exportDropdownBtn.innerHTML = origText; 
            exportDropdownBtn.style.background = "var(--ktz-blue)"; 
            exportDropdownBtn.style.color = "#fff"; 
        }, 2000);
    }

    exportCsvBtn.addEventListener('click', (e) => {
        e.preventDefault();
        let csvContent = "Время,Скорость (км/ч),Температура (°C),Статус\n" + getExportData().map(row => row.join(",")).join("\n");
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' }));
        link.download = `KTZ_Telemetry_${new Date().toLocaleTimeString().replace(/:/g, '-')}.csv`;
        link.click(); 
        showExportSuccess();
    });

    exportPdfBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const { jsPDF } = window.jspdf; 
        const doc = new jsPDF();
        
        doc.setFontSize(18); doc.setTextColor(0, 163, 224); doc.text("KTZ Loco-Twin Telemetry Report", 14, 22);
        doc.setFontSize(10); doc.setTextColor(100, 100, 100); doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 30);
        
        if (isFailureMode) { 
            doc.setTextColor(239, 68, 68); doc.text("SYSTEM STATUS: CRITICAL INCIDENT", 14, 36); 
        }
        
        doc.autoTable({
            startY: 45, head: [['Time', 'Speed (km/h)', 'Temperature (C)', 'Status']], body: getExportData(), theme: 'grid', headStyles: { fillColor: [0, 163, 224] },
            didParseCell: function(data) {
                if (data.section === 'body' && data.column.index === 3) {
                    if (data.cell.raw === 'CRITICAL') { 
                        data.cell.styles.textColor = [239, 68, 68]; data.cell.styles.fontStyle = 'bold'; 
                    } else if (data.cell.raw === 'WARNING') { 
                        data.cell.styles.textColor = [234, 179, 8]; 
                    }
                }
            }
        });
        doc.save(`KTZ_Telemetry_${new Date().toLocaleTimeString().replace(/:/g, '-')}.pdf`); 
        showExportSuccess();
    });

    // ==========================================
    // 7. ПЕРЕКЛЮЧЕНИЕ ТЕМЫ (ВНУТРИ DOMContentLoaded)
    // ==========================================
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    
    function applyChartTheme() {
        const isLight = document.body.classList.contains('light-mode');
        const textColor = isLight ? '#4b5563' : '#a1a1aa';
        const gridColor = isLight ? '#e5e7eb' : '#222';
        const tooltipBg = isLight ? 'rgba(255, 255, 255, 0.95)' : 'rgba(10, 11, 14, 0.9)';
        const tooltipText = isLight ? '#111827' : '#fff';

        myChart.setOption({
            tooltip: { backgroundColor: tooltipBg, borderColor: gridColor, textStyle: { color: tooltipText } },
            legend: { textStyle: { color: textColor } },
            xAxis: { axisLabel: { color: textColor } },
            yAxis: [
                { splitLine: { lineStyle: { color: gridColor } }, axisLabel: { color: textColor } },
                { axisLabel: { color: textColor } }
            ]
        });
        
        updateChartView(); // Функция теперь доступна!
    }

    if (localStorage.getItem('theme') === 'light') {
        document.body.classList.add('light-mode');
        themeToggleBtn.innerHTML = '🌙 Dark';
    }
    
    applyChartTheme();

    themeToggleBtn.addEventListener('click', () => {
        document.body.classList.toggle('light-mode');
        const isLight = document.body.classList.contains('light-mode');
        localStorage.setItem('theme', isLight ? 'light' : 'dark');
        themeToggleBtn.innerHTML = isLight ? '🌙 Dark' : '☀️ Light';
        applyChartTheme();
    });

    window.addEventListener('resize', () => myChart.resize());
});