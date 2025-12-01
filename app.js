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

            // 2. Determine Date Range (Last 30 days from last reading or today)
            const end = new Date();
            const start = new Date();
            start.setDate(start.getDate() - 60); // Get last 60 days to be safe

            const startStr = start.toISOString().slice(0, 10);
            const endStr = end.toISOString().slice(0, 10);

            // 3. Fetch Weather
            const weatherUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${startStr}&end_date=${endStr}&daily=temperature_2m_mean&timezone=auto`;
            const weatherRes = await fetch(weatherUrl);
            const weatherData = await weatherRes.json();

            // 4. Cache
            if (weatherData.daily) {
                weatherData.daily.time.forEach((t, i) => {
                    this.weatherCache[t] = weatherData.daily.temperature_2m_mean[i];
                });
                this.save();
                this.render();
                alert('Weather data updated!');
            }
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
        tbody.innerHTML = '';
        
        this.data.forEach((d, i) => {
            const tr = document.createElement('tr');
            if (this.selection.has(d.id)) tr.classList.add('selected');
            
            let diff = '-', cost = '-';
            if (i > 0) {
                const prev = this.data[i-1];
                const usage = d.reading - prev.reading;
                const days = (d.date - prev.date) / 86400000;
                diff = usage.toFixed(3);
                cost = '€' + this.calculateCost(usage, days).toFixed(2);
            }

            tr.innerHTML = `
                <td><input type="checkbox" ${this.selection.has(d.id) ? 'checked' : ''} onclick="app.toggleSelection(${d.id})"></td>
                <td>${this.formatDate(d.date)}</td>
                <td>${d.reading.toFixed(3)}</td>
                <td>${diff}</td>
                <td>${cost}</td>
                <td><button class="danger" style="width:auto; padding:0.25rem 0.5rem;" onclick="app.deleteReading(${d.id})">×</button></td>
            `;
            tbody.appendChild(tr);
        });
    }

    renderAnalysis() {
        const panel = document.getElementById('analysisPanel');
        if (this.selection.size !== 2) return panel.classList.add('hidden');
        
        panel.classList.remove('hidden');
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

        // 3. Cumulative
        this.updateChart('chartCumulative', 'line', {
            labels,
            datasets: [{
                label: 'Cumulative Cost (€)',
                data: cumCost,
                borderColor: '#00cc66',
                fill: true,
                backgroundColor: 'rgba(0, 204, 102, 0.1)'
            }]
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

        const projData = [];
        if (source.length >= 2) {
            let pCost = 0;
            const startNode = source[0];
            
            source.forEach((d, i) => {
                if (i === 0) return;
                const prev = source[i-1];
                const days = (d.date - prev.date) / 86400000;
                pCost += this.calculateCost(d.reading - prev.reading, days);
                
                const totalDays = (d.date - startNode.date) / 86400000;
                if (totalDays > 0) {
                    projData.push({ x: d.date, y: (pCost / totalDays) * 30 });
                }
            });
        }

        const datasets = [{
            label: '30-Day Projection (€)',
            data: projData,
            borderColor: '#ff9900',
            borderDash: [5,5]
        }];

        this.updateChart('chartProjection', 'line', {
            datasets: datasets
        }, {
            plugins: { title: { display: true, text: title } },
            scales: { x: { type: 'time', time: { unit: 'day' } }, y: { beginAtZero: true } }
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
