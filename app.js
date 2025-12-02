const CONSTANTS = {
    CONVERSION: 10.9130,
    TAX_RATE: 0.00234,
    VAT: 0.21
};

const INITIAL_DATA = [ ];

class GasApp {
    constructor() {
        this.data = [];
        this.settings = { price: 0.04293925, fixed: 0.26663, postcode: '' };
        this.selection = new Set();
        this.charts = {};
        this.weatherCache = {};
        this.forecastCache = {};
        
        this.init();
    }

    init() {
        this.load();
        this.bindInputs();
        this.render();
    }

    bindInputs() {
        document.getElementById('cfgPrice').value = this.settings.price;
        document.getElementById('cfgFixed').value = this.settings.fixed;
        document.getElementById('cfgPostcode').value = this.settings.postcode || '';
        
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        document.getElementById('inpDate').value = now.toISOString().slice(0, 16);
    }

    load() {
        const stored = localStorage.getItem('gasData');
        const storedSettings = localStorage.getItem('gasSettings');
        const storedWeather = localStorage.getItem('gasWeather');
        const storedForecast = localStorage.getItem('gasForecast');
        
        if (stored) {
            this.data = JSON.parse(stored).map(d => ({...d, date: new Date(d.date)}));
        } else {
            this.data = INITIAL_DATA.map(d => ({
                id: Date.now() + Math.random(),
                date: new Date(d.date),
                reading: d.reading
            }));
        }

        if (storedSettings) this.settings = JSON.parse(storedSettings);
        if (storedWeather) this.weatherCache = JSON.parse(storedWeather);
        if (storedForecast) this.forecastCache = JSON.parse(storedForecast);
        
        // Default selection
        if (this.data.length >= 2 && this.selection.size === 0) {
            this.data.sort((a,b) => a.date - b.date);
            this.selection.add(this.data[0].id);
            this.selection.add(this.data[this.data.length-1].id);
        }
    }

    save() {
        localStorage.setItem('gasData', JSON.stringify(this.data));
        localStorage.setItem('gasSettings', JSON.stringify(this.settings));
        localStorage.setItem('gasWeather', JSON.stringify(this.weatherCache));
        localStorage.setItem('gasForecast', JSON.stringify(this.forecastCache));
    }

    async fetchWeather() {
        const postcode = document.getElementById('cfgPostcode').value;
        if (!postcode) return alert('Please enter a postcode');
        
        this.settings.postcode = postcode;
        this.save();

        try {
            // 1. Geocode
            const geoRes = await fetch(`https://api.zippopotam.us/es/${postcode}`);
            if (!geoRes.ok) throw new Error('Invalid Postcode');
            const geoData = await geoRes.json();
            const lat = geoData.places[0].latitude;
            const lon = geoData.places[0].longitude;

            // 2. Fetch Weather (Past 31 days + Future 16 days)
            // Using forecast endpoint with past_days gets us recent actuals/estimates which is better than archive
            // Note: API limits - past_days max is around 61-92 depending on location, forecast_days max is 16
            const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_mean&timezone=auto&past_days=92&forecast_days=16`;
            const weatherRes = await fetch(weatherUrl);
            if (!weatherRes.ok) {
                throw new Error(`Weather API error: ${weatherRes.status}`);
            }
            const weatherData = await weatherRes.json();

            if (weatherData.daily) {
                this.forecastCache = {}; // Clear old forecast
                const today = new Date().toISOString().slice(0, 10);

                weatherData.daily.time.forEach((t, i) => {
                    const temp = weatherData.daily.temperature_2m_mean[i];
                    // Update both caches. Overwrite old data with potentially newer corrected data.
                    if (t <= today) {
                        this.weatherCache[t] = temp;
                    } else {
                        this.forecastCache[t] = temp;
                    }
                });
            }

            this.save();
            this.render();
            alert('Weather data updated!');
        } catch (e) {
            alert('Error fetching weather: ' + e.message);
        }
    }

    addReading() {
        const date = document.getElementById('inpDate').value;
        const reading = parseFloat(document.getElementById('inpReading').value);
        
        if (!date || isNaN(reading)) return alert('Invalid input');
        
        this.data.push({
            id: Date.now(),
            date: new Date(date),
            reading: reading
        });
        
        this.save();
        this.render();
    }

    updateSettings() {
        this.settings.price = parseFloat(document.getElementById('cfgPrice').value);
        this.settings.fixed = parseFloat(document.getElementById('cfgFixed').value);
        this.save();
        this.render();
    }

    exportData() {
        const blob = new Blob([JSON.stringify({data: this.data, settings: this.settings}, null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'gas_data_backup.json';
        a.click();
    }

    importData(input) {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const json = JSON.parse(e.target.result);
                if (json.data) this.data = json.data.map(d => ({...d, date: new Date(d.date)}));
                if (json.settings) this.settings = {...this.settings, ...json.settings};
                this.save();
                this.bindInputs();
                this.render();
                alert('Data restored successfully!');
            } catch (err) { alert('Invalid file format'); }
        };
        reader.readAsText(file);
    }

    resetData() {
        if(confirm('Reset all data?')) {
            localStorage.removeItem('gasData');
            this.selection.clear();
            this.load();
            this.render();
        }
    }

    deleteReading(id) {
        if(confirm('Delete reading?')) {
            this.data = this.data.filter(d => d.id !== id);
            this.selection.delete(id);
            this.save();
            this.render();
        }
    }

    toggleSelection(id) {
        if (this.selection.has(id)) {
            this.selection.delete(id);
        } else {
            if (this.selection.size >= 2) {
                const it = this.selection.values();
                this.selection.delete(it.next().value);
            }
            this.selection.add(id);
        }
        this.render();
    }

    calculateCost(m3, days) {
        if (m3 < 0) return 0;
        const energy = m3 * CONSTANTS.CONVERSION;
        const variable = energy * this.settings.price;
        const fixed = days * this.settings.fixed;
        const tax = energy * CONSTANTS.TAX_RATE;
        return (variable + fixed + tax) * (1 + CONSTANTS.VAT);
    }

    getNormalizedData() {
        if (this.data.length < 2) return [];
        const sorted = [...this.data].sort((a,b) => a.date - b.date);
        const start = sorted[0].date;
        const end = sorted[sorted.length-1].date;
        
        let current = new Date(start);
        current.setHours(0,0,0,0);
        
        const points = [];
        while(current <= end) {
            const t = current.getTime();
            // Interpolate
            const nextIdx = sorted.findIndex(d => d.date.getTime() >= t);
            let val;
            if (nextIdx <= 0) val = sorted[0].reading;
            else {
                const prev = sorted[nextIdx-1];
                const next = sorted[nextIdx];
                const factor = (t - prev.date.getTime()) / (next.date.getTime() - prev.date.getTime());
                val = prev.reading + factor * (next.reading - prev.reading);
            }
            
            points.push({ date: new Date(current), reading: val });
            current.setDate(current.getDate() + 1);
        }
        return points;
    }

    render() {
        this.data.sort((a,b) => a.date - b.date);
        this.renderTable();
        this.renderAnalysis();
        this.renderCharts();
    }

    formatDate(date) {
        return date.toISOString().slice(0, 16).replace('T', ' ');
    }

    renderTable() {
        const tbody = document.querySelector('#dataTable tbody');
        tbody.innerHTML = this.data.map((d, i) => {
            let diff = '-', cost = '-';
            if (i > 0) {
                const prev = this.data[i-1];
                const usage = d.reading - prev.reading;
                const days = (d.date - prev.date) / 86400000;
                diff = usage.toFixed(3);
                cost = '€' + this.calculateCost(usage, days).toFixed(2);
            }
            const isSelected = this.selection.has(d.id) ? 'selected' : '';
            const checked = this.selection.has(d.id) ? 'checked' : '';
            return `
                <tr class="${isSelected}">
                    <td><input type="checkbox" ${checked} onclick="app.toggleSelection(${d.id})"></td>
                    <td>${this.formatDate(d.date)}</td>
                    <td>${d.reading.toFixed(3)}</td>
                    <td>${diff}</td>
                    <td>${cost}</td>
                    <td><button class="danger btn-sm" onclick="app.deleteReading(${d.id})">×</button></td>
                </tr>
            `;
        }).join('');
    }

    renderAnalysis() {
        const panel = document.getElementById('analysisPanel');
        const placeholder = document.getElementById('analysisPlaceholder');
        
        if (this.selection.size !== 2) {
            panel.classList.add('hidden');
            if (placeholder) placeholder.classList.remove('hidden');
            return;
        }
        
        panel.classList.remove('hidden');
        if (placeholder) placeholder.classList.add('hidden');

        const ids = Array.from(this.selection);
        const r1 = this.data.find(d => d.id === ids[0]);
        const r2 = this.data.find(d => d.id === ids[1]);
        
        const [start, end] = r1.date < r2.date ? [r1, r2] : [r2, r1];
        const days = (end.date - start.date) / 86400000;
        const usage = end.reading - start.reading;
        const cost = this.calculateCost(usage, days);

        document.getElementById('outDays').textContent = days.toFixed(2);
        document.getElementById('outUsage').textContent = usage.toFixed(3) + ' m³';
        document.getElementById('outCost').textContent = '€' + cost.toFixed(2);
        document.getElementById('outProj').textContent = '€' + ((cost / days) * 30).toFixed(2);
    }

    renderCharts() {
        // 1. Readings Timeline
        this.updateChart('chartReadings', 'line', {
            datasets: [{
                label: 'Reading Value',
                data: this.data.map(d => ({x: d.date, y: d.reading})),
                borderColor: '#0066cc',
                backgroundColor: '#0066cc',
                showLine: true,
                pointRadius: 4
            }]
        }, { scales: { x: { type: 'time', time: { unit: 'day' } } } });

        const norm = this.getNormalizedData();
        if (norm.length < 2) return;

        // Prepare Daily & Cumulative Data
        const labels = [], dailyCost = [], dailyUsage = [], cumCost = [];
        let running = 0;

        for(let i=1; i<norm.length; i++) {
            const curr = norm[i];
            const usage = curr.reading - norm[i-1].reading;
            const cost = this.calculateCost(usage, 1);
            
            labels.push(curr.date.toISOString().slice(0,10));
            dailyCost.push(cost);
            dailyUsage.push(usage);
            running += cost;
            cumCost.push(running);
        }

        // 2. Daily Usage
        this.updateChart('chartDaily', 'bar', {
            labels,
            datasets: [
                { label: 'Cost (€)', data: dailyCost, backgroundColor: '#0066cc', yAxisID: 'y' },
                { label: 'Usage (m³)', data: dailyUsage, type: 'line', borderColor: '#ff9900', yAxisID: 'y1' }
            ]
        }, {
            scales: {
                y: { position: 'left' },
                y1: { position: 'right', grid: { drawOnChartArea: false } }
            }
        });

        // 3. Cumulative - with breakdown of tax, fixed, and IVA
        const cumVariable = [], cumFixed = [], cumTax = [], cumIVA = [], cumTotal = [];
        let runningVariable = 0, runningFixed = 0, runningTax = 0, runningIVA = 0, runningTotal = 0;

        for(let i=1; i<norm.length; i++) {
            const curr = norm[i];
            const usage = curr.reading - norm[i-1].reading;
            const energy = usage * CONSTANTS.CONVERSION;
            
            const variable = energy * this.settings.price;
            const fixed = this.settings.fixed;
            const tax = energy * CONSTANTS.TAX_RATE;
            const subtotal = variable + fixed + tax;
            const iva = subtotal * CONSTANTS.VAT;
            const total = subtotal + iva;
            
            runningVariable += variable;
            runningFixed += fixed;
            runningTax += tax;
            runningIVA += iva;
            runningTotal += total;
            
            cumVariable.push(runningVariable);
            cumFixed.push(runningFixed);
            cumTax.push(runningTax);
            cumIVA.push(runningIVA);
            cumTotal.push(runningTotal);
        }

        this.updateChart('chartCumulative', 'line', {
            labels,
            datasets: [
                {
                    label: 'Total Cost',
                    data: cumTotal,
                    borderColor: '#00cc66',
                    backgroundColor: 'rgba(0, 204, 102, 0.1)',
                    fill: true,
                    borderWidth: 3
                },
                {
                    label: 'Variable Cost',
                    data: cumVariable,
                    borderColor: '#0066cc',
                    backgroundColor: 'rgba(0, 102, 204, 0.1)',
                    fill: true,
                    borderWidth: 2
                },
                {
                    label: 'Fixed Charges',
                    data: cumFixed,
                    borderColor: '#ff9900',
                    backgroundColor: 'rgba(255, 153, 0, 0.1)',
                    fill: true,
                    borderWidth: 2
                },
                {
                    label: 'Tax',
                    data: cumTax,
                    borderColor: '#cc0000',
                    backgroundColor: 'rgba(204, 0, 0, 0.1)',
                    fill: true,
                    borderWidth: 2
                },
                {
                    label: 'IVA',
                    data: cumIVA,
                    borderColor: '#9933cc',
                    backgroundColor: 'rgba(153, 51, 204, 0.1)',
                    fill: true,
                    borderWidth: 2
                }
            ]
        });

        // 4. Projection Evolution
        this.renderProjectionChart();

        // 5. Cost Breakdown
        this.renderBreakdownChart();

        // 6. Weather vs Usage
        this.renderWeatherChart();

        // 7. Efficiency Correlation
        this.renderScatterChart();

        // 8. Heating Efficiency
        this.renderEfficiencyChart();

        // 9. Smart Forecast
        this.renderSmartProjection();
    }

    calculateRegression() {
        const norm = this.getNormalizedData();
        if (norm.length < 2) return null;

        const points = norm.slice(1).map((curr, i) => {
            const temp = this.weatherCache[curr.date.toISOString().slice(0,10)];
            return (temp !== undefined) ? { x: temp, y: curr.reading - norm[i].reading } : null;
        }).filter(p => p !== null);

        if (points.length < 5) return null;

        const n = points.length;
        const sum = points.reduce((acc, p) => ({
            x: acc.x + p.x, y: acc.y + p.y, xy: acc.xy + p.x * p.y, xx: acc.xx + p.x * p.x
        }), { x: 0, y: 0, xy: 0, xx: 0 });

        const slope = (n * sum.xy - sum.x * sum.y) / (n * sum.xx - sum.x * sum.x);
        const intercept = (sum.y - slope * sum.x) / n;

        const meanY = sum.y / n;
        const ss = points.reduce((acc, p) => ({
            tot: acc.tot + Math.pow(p.y - meanY, 2),
            res: acc.res + Math.pow(p.y - (slope * p.x + intercept), 2)
        }), { tot: 0, res: 0 });

        return { slope, intercept, r2: 1 - (ss.res / ss.tot), count: n };
    }

    renderSmartProjection() {
        const model = this.calculateRegression();
        const forecastDates = Object.keys(this.forecastCache).sort().slice(0, 16);
        
        const els = {
            temp: document.getElementById('fcTemp'),
            usage: document.getElementById('fcUsage'),
            cost: document.getElementById('fcCost'),
            conf: document.getElementById('fcConf')
        };

        if (!model || forecastDates.length === 0) {
            Object.values(els).forEach(el => el.textContent = '-');
            // Clear the chart or show empty state
            this.updateChart('chartForecast', 'bar', {
                labels: [],
                datasets: []
            }, {
                scales: {
                    y: { beginAtZero: true, position: 'left', title: { display: true, text: 'Usage (m³)' } },
                    y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Temp (°C)' } }
                },
                plugins: { legend: { display: true } },
                maintainAspectRatio: false
            });
            return;
        }

        let totalUsage = 0, totalTemp = 0;
        const chartData = { labels: [], usage: [], temp: [] };

        forecastDates.forEach(date => {
            const temp = this.forecastCache[date];
            const predicted = Math.max(0, model.slope * temp + model.intercept);
            
            totalUsage += predicted;
            totalTemp += temp;

            chartData.labels.push(date);
            chartData.usage.push(predicted);
            chartData.temp.push(temp);
        });

        const avgTemp = totalTemp / forecastDates.length;
        const cost = this.calculateCost(totalUsage, forecastDates.length);
        
        const confidence = (model.r2 > 0.7 && model.count > 20) ? 'High' : 
                          (model.r2 > 0.4 && model.count > 10) ? 'Medium' : 'Low';

        els.temp.textContent = avgTemp.toFixed(1) + '°C';
        els.usage.textContent = totalUsage.toFixed(1) + ' m³';
        els.cost.textContent = '€' + cost.toFixed(2);
        els.conf.textContent = `${confidence} (R² ${(model.r2*100).toFixed(0)}%)`;

        this.updateChart('chartForecast', 'bar', {
            labels: chartData.labels,
            datasets: [
                { label: 'Predicted Usage (m³)', data: chartData.usage, backgroundColor: 'rgba(54, 162, 235, 0.6)', borderColor: 'rgba(54, 162, 235, 1)', borderWidth: 1, yAxisID: 'y' },
                { label: 'Temperature (°C)', data: chartData.temp, type: 'line', borderColor: '#ff9900', backgroundColor: '#ff9900', borderWidth: 2, pointRadius: 4, yAxisID: 'y1' }
            ]
        }, {
            scales: {
                y: { beginAtZero: true, position: 'left', title: { display: true, text: 'Usage (m³)' } },
                y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Temp (°C)' } },
                x: { ticks: { maxTicksLimit: 10 } }
            },
            plugins: { legend: { display: true } },
            maintainAspectRatio: false
        });
    }

    renderEfficiencyChart() {
        const norm = this.getNormalizedData();
        if (norm.length < 2) return;

        const dataPoints = [];
        const BASE_TEMP = 15.5; // Standard base temperature for heating

        for(let i=1; i<norm.length; i++) {
            const curr = norm[i];
            const dateStr = curr.date.toISOString().slice(0,10);
            const usage = curr.reading - norm[i-1].reading;
            const temp = this.weatherCache[dateStr];

            if (temp !== undefined && temp !== null) {
                const hdd = BASE_TEMP - temp;
                // Only calculate if it's cold enough to require heating (HDD > 0)
                // and avoid division by zero or tiny numbers
                if (hdd > 0.5) {
                    const efficiency = usage / hdd;
                    dataPoints.push({ x: curr.date, y: efficiency });
                }
            }
        }

        this.updateChart('chartEfficiency', 'line', {
            datasets: [{
                label: 'm³ / Degree-Day',
                data: dataPoints,
                borderColor: '#9933cc',
                backgroundColor: 'rgba(153, 51, 204, 0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 3
            }]
        }, {
            scales: {
                x: { type: 'time', time: { unit: 'day' } },
                y: { 
                    beginAtZero: true,
                    title: { display: true, text: 'm³ per Degree below 15.5°C' }
                }
            }
        });
    }

    renderScatterChart() {
        const norm = this.getNormalizedData();
        if (norm.length < 2) return;

        const points = [];

        for(let i=1; i<norm.length; i++) {
            const curr = norm[i];
            const dateStr = curr.date.toISOString().slice(0,10);
            const usage = curr.reading - norm[i-1].reading;
            const temp = this.weatherCache[dateStr];

            if (temp !== undefined && temp !== null) {
                points.push({ x: temp, y: usage });
            }
        }

        this.updateChart('chartScatter', 'scatter', {
            datasets: [{
                label: 'Daily Usage vs Temp',
                data: points,
                backgroundColor: 'rgba(255, 153, 0, 0.6)',
                borderColor: '#ff9900',
                pointRadius: 5,
                pointHoverRadius: 7
            }]
        }, {
            scales: {
                x: { 
                    type: 'linear', 
                    position: 'bottom',
                    title: { display: true, text: 'Temperature (°C)' }
                },
                y: { 
                    beginAtZero: true,
                    title: { display: true, text: 'Gas Usage (m³)' }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `Temp: ${context.parsed.x}°C, Usage: ${context.parsed.y.toFixed(3)} m³`;
                        }
                    }
                }
            }
        });
    }

    renderWeatherChart() {
        const norm = this.getNormalizedData();
        if (norm.length < 2) return;

        const labels = [];
        const usageData = [];
        const tempData = [];

        for(let i=1; i<norm.length; i++) {
            const curr = norm[i];
            const dateStr = curr.date.toISOString().slice(0,10);
            const usage = curr.reading - norm[i-1].reading;
            
            labels.push(dateStr);
            usageData.push(usage);
            tempData.push(this.weatherCache[dateStr] || null);
        }

        this.updateChart('chartWeather', 'bar', {
            labels: labels,
            datasets: [
                { 
                    label: 'Gas Usage (m³)', 
                    data: usageData, 
                    backgroundColor: 'rgba(0, 102, 204, 0.6)',
                    yAxisID: 'y'
                },
                { 
                    label: 'Temperature (°C)', 
                    data: tempData, 
                    type: 'line',
                    borderColor: '#cc0000',
                    backgroundColor: '#cc0000',
                    yAxisID: 'y1',
                    tension: 0.4
                }
            ]
        }, {
            scales: {
                y: { 
                    position: 'left',
                    title: { display: true, text: 'Usage (m³)' }
                },
                y1: { 
                    position: 'right', 
                    grid: { drawOnChartArea: false },
                    title: { display: true, text: 'Temperature (°C)' }
                }
            }
        });
    }

    renderBreakdownChart() {
        let source = [...this.data];
        let title = 'Cost Breakdown (All Data)';

        if (this.selection.size === 2) {
            const ids = Array.from(this.selection);
            const r1 = this.data.find(d => d.id === ids[0]);
            const r2 = this.data.find(d => d.id === ids[1]);
            const [start, end] = r1.date < r2.date ? [r1, r2] : [r2, r1];
            
            source = this.data.filter(d => d.date >= start.date && d.date <= end.date);
            title = `Cost Breakdown (${this.formatDate(start.date)} - ${this.formatDate(end.date)})`;
        }

        if (source.length < 2) return;

        source.sort((a,b) => a.date - b.date);
        const start = source[0];
        const end = source[source.length-1];
        
        const days = (end.date - start.date) / 86400000;
        const usage = end.reading - start.reading;
        
        const energy = usage * CONSTANTS.CONVERSION;
        const variable = energy * this.settings.price;
        const fixed = days * this.settings.fixed;
        const hydroTax = energy * CONSTANTS.TAX_RATE;
        
        const subtotal = variable + fixed + hydroTax;
        const vat = subtotal * CONSTANTS.VAT;
        const totalTax = hydroTax + vat;

        this.updateChart('chartBreakdown', 'doughnut', {
            labels: ['Gas Usage', 'Fixed Charges', 'Taxes'],
            datasets: [{
                data: [variable, fixed, totalTax],
                backgroundColor: ['#0066cc', '#ff9900', '#cc0000'],
                borderWidth: 0
            }]
        }, {
            plugins: { 
                title: { display: true, text: title },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed !== null) {
                                label += '€' + context.parsed.toFixed(2);
                            }
                            return label;
                        }
                    }
                }
            }
        });
    }

    renderProjectionChart() {
        let source = [...this.data];
        let title = 'Projection Evolution (All Data)';

        if (this.selection.size === 2) {
            const ids = Array.from(this.selection);
            const r1 = this.data.find(d => d.id === ids[0]);
            const r2 = this.data.find(d => d.id === ids[1]);
            const [start, end] = r1.date < r2.date ? [r1, r2] : [r2, r1];
            
            source = this.data.filter(d => d.date >= start.date && d.date <= end.date);
            title = `Projection (${this.formatDate(start.date)} - ${this.formatDate(end.date)})`;
        }

        const simpleProjection = [];
        const smartProjection = [];
        
        if (source.length >= 2) {
            // Calculate daily usage rates and costs for intelligent analysis
            const dailyData = [];
            for (let i = 1; i < source.length; i++) {
                const prev = source[i-1];
                const curr = source[i];
                const days = (curr.date - prev.date) / 86400000;
                const usage = curr.reading - prev.reading;
                const dailyRate = usage / days; // m³ per day
                const cost = this.calculateCost(usage, days);
                const dailyCost = cost / days;
                
                // Get temperature if available
                const dateStr = curr.date.toISOString().slice(0,10);
                const temp = this.weatherCache[dateStr];
                
                dailyData.push({ 
                    index: i, 
                    date: curr.date,
                    rate: dailyRate, 
                    days: days, 
                    usage: usage,
                    cost: cost,
                    dailyCost: dailyCost,
                    temp: temp
                });
            }

            // Multi-factor anomaly detection
            const rates = dailyData.map(d => d.rate).sort((a, b) => a - b);
            const costs = dailyData.map(d => d.dailyCost).sort((a, b) => a - b);
            
            // IQR-based outlier detection for usage rates
            const q1Rate = rates[Math.floor(rates.length * 0.25)];
            const q3Rate = rates[Math.floor(rates.length * 0.75)];
            const iqrRate = q3Rate - q1Rate;
            const lowerBoundRate = q1Rate - 1.5 * iqrRate;
            const upperBoundRate = q3Rate + 1.5 * iqrRate;
            
            // IQR-based outlier detection for costs
            const q1Cost = costs[Math.floor(costs.length * 0.25)];
            const q3Cost = costs[Math.floor(costs.length * 0.75)];
            const iqrCost = q3Cost - q1Cost;
            const upperBoundCost = q3Cost + 2.0 * iqrCost; // More lenient on cost spikes
            
            // Calculate median and mean for adaptive weighting
            const medianRate = rates[Math.floor(rates.length / 2)];
            const meanRate = rates.reduce((a, b) => a + b, 0) / rates.length;

            let pCost = 0;
            let smartCost = 0;
            let smartDays = 0;
            let recentWindow = [];
            const startNode = source[0];
            
            // Calculate both projections
            source.forEach((d, i) => {
                if (i === 0) return;
                
                const dataPoint = dailyData[i - 1];
                const { days, usage, cost, rate: dailyRate, dailyCost, temp } = dataPoint;
                
                // Simple projection (all data)
                pCost += cost;
                const totalDays = (d.date - startNode.date) / 86400000;
                if (totalDays > 0) {
                    simpleProjection.push({ x: d.date, y: (pCost / totalDays) * 30 });
                }
                
                // Smart anomaly detection with multiple factors
                let isAnomaly = false;
                
                // Factor 1: Statistical outlier (rate or cost)
                const isRateOutlier = dailyRate < lowerBoundRate || dailyRate > upperBoundRate;
                const isCostOutlier = dailyCost > upperBoundCost;
                
                // Factor 2: Deviation from recent trend (if we have enough data)
                recentWindow.push(dailyRate);
                if (recentWindow.length > 7) recentWindow.shift();
                let isRecentDeviation = false;
                if (recentWindow.length >= 5) {
                    const recentAvg = recentWindow.slice(0, -1).reduce((a, b) => a + b, 0) / (recentWindow.length - 1);
                    const recentStd = Math.sqrt(recentWindow.slice(0, -1).reduce((sum, v) => sum + Math.pow(v - recentAvg, 2), 0) / (recentWindow.length - 1));
                    isRecentDeviation = Math.abs(dailyRate - recentAvg) > 2.5 * recentStd;
                }
                
                // Factor 3: Temperature correlation check (if available)
                let isTempAnomaly = false;
                if (temp !== undefined && temp !== null && dailyData.length >= 10) {
                    // Check if usage is extremely low when it's very cold, or extremely high when warm
                    const tempData = dailyData.filter(dd => dd.temp !== undefined && dd.temp !== null);
                    if (tempData.length >= 10) {
                        const avgTemp = tempData.reduce((sum, dd) => sum + dd.temp, 0) / tempData.length;
                        // Unusual usage pattern: very high usage when warm OR very low usage when cold
                        if ((temp > avgTemp + 5 && dailyRate > medianRate * 1.8) || 
                            (temp < avgTemp - 5 && dailyRate < medianRate * 0.3)) {
                            isTempAnomaly = true;
                        }
                    }
                }
                
                // Combine factors: mark as anomaly if multiple indicators agree
                if (isRateOutlier || isCostOutlier) {
                    isAnomaly = true;
                } else if (isRecentDeviation && isTempAnomaly) {
                    isAnomaly = true;
                }
                
                // Add to smart calculation if not anomaly
                if (!isAnomaly) {
                    smartCost += cost;
                    smartDays += days;
                }
                
                // Always show projection point
                if (smartDays > 0) {
                    smartProjection.push({ x: d.date, y: (smartCost / smartDays) * 30 });
                } else {
                    // If all data so far is anomalies, use simple projection as fallback
                    smartProjection.push({ x: d.date, y: (pCost / totalDays) * 30 });
                }
            });
        }

        const datasets = [
            {
                label: 'Simple Average (€)',
                data: simpleProjection,
                borderColor: '#ff9900',
                borderDash: [5, 5],
                borderWidth: 2,
                pointRadius: 3,
                pointBackgroundColor: '#ff9900'
            }
        ];
        
        // Only add smart projection if we have enough data
        if (smartProjection.length > 0) {
            datasets.push({
                label: 'Smart Prediction (€)',
                data: smartProjection,
                borderColor: '#00cc66',
                borderWidth: 2,
                pointRadius: 3,
                pointBackgroundColor: '#00cc66'
            });
        }

        this.updateChart('chartProjection', 'line', {
            datasets: datasets
        }, {
            plugins: { 
                title: { display: true, text: title },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': €' + context.parsed.y.toFixed(2);
                        }
                    }
                }
            },
            scales: { 
                x: { type: 'time', time: { unit: 'day' } }, 
                y: { beginAtZero: true, title: { display: true, text: '30-Day Cost (€)' } }
            }
        });
    }

    updateChart(id, type, data, options = {}) {
        const ctx = document.getElementById(id).getContext('2d');
        if (this.charts[id]) this.charts[id].destroy();
        
        this.charts[id] = new Chart(ctx, {
            type: type,
            data: data,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { position: 'top' } },
                ...options
            }
        });
    }
}

const app = new GasApp();
