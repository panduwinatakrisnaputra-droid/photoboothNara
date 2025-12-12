// Dapatkan referensi elemen DOM
const videoElement = document.getElementById('videoElement');
const canvasElement = document.getElementById('canvasElement');
const startButton = document.getElementById('startButton');
const captureButton = document.getElementById('captureButton');
const switchCameraButton = document.getElementById('switchCameraButton');
const downloadButton = document.getElementById('downloadButton'); 
// BARU: Tombol Foto Ulang
const retakeButton = document.getElementById('retakeButton'); 
const resultContainer = document.getElementById('resultContainer');
const stripLayoutSelect = document.getElementById('stripLayout');
const singleStripFrame = document.getElementById('singleStripFrame');
const gridStripFrame = document.getElementById('gridStripFrame');

// Elemen Preview
const previewContainer = document.getElementById('previewContainer');
const previewCanvas = document.getElementById('previewCanvas'); 

let currentStream = null;
let cameraDevices = [];
let currentDeviceIndex = 0;
const captureCount = 3; 

let loadedFrameImages = {};
let lastPhotoURL = null; // Menyimpan URL foto terakhir

/**
 * Muat semua gambar bingkai desain saat inisialisasi.
 */
function loadFrameImages() {
    return new Promise(resolve => {
        let loadedCount = 0;
        const totalFrames = 2; 

        const handleLoad = (id, element) => {
            if (element && element.src) {
                const img = new Image();
                img.onload = () => {
                    loadedFrameImages[id] = img;
                    loadedCount++;
                    if (loadedCount === totalFrames) resolve();
                };
                img.onerror = () => {
                    console.error(`Gagal memuat bingkai ${id}.`);
                    loadedCount++;
                    if (loadedCount === totalFrames) resolve();
                };
                img.src = element.src;
            } else {
                loadedCount++;
                if (loadedCount === totalFrames) resolve();
            }
        };

        handleLoad('single', singleStripFrame);
        handleLoad('grid', gridStripFrame);
    });
}


/**
 * Mendapatkan daftar perangkat video (kamera) yang tersedia.
 */
async function getCameraDevices() {
    try {
        await navigator.mediaDevices.getUserMedia({ video: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        cameraDevices = devices.filter(device => device.kind === 'videoinput');
        
        if (cameraDevices.length > 1) {
            switchCameraButton.style.display = 'inline-block';
        }
    } catch (error) {
        console.error("Gagal mendapatkan daftar kamera:", error);
    }
}

/**
 * Memulai streaming kamera berdasarkan deviceId yang dipilih.
 */
async function startCamera(deviceId) {
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
    }

    const constraints = {
        video: { 
            deviceId: deviceId ? { exact: deviceId } : undefined 
        }
    };

    try {
        currentStream = await navigator.mediaDevices.getUserMedia(constraints);
        videoElement.srcObject = currentStream;
        
        videoElement.onloadedmetadata = () => {
            videoElement.play();
            captureButton.disabled = false;
            startButton.style.display = 'none';
            updatePreview(stripLayoutSelect.value); 
        };
    } catch (error) {
        console.error("Akses kamera ditolak atau gagal:", error);
        alert("Gagal mengakses kamera. Pastikan Anda memberikan izin.");
    }
}

/**
 * Mengganti kamera depan/belakang
 */
function switchCamera() {
    if (cameraDevices.length > 1) {
        currentDeviceIndex = (currentDeviceIndex + 1) % cameraDevices.length;
        const nextDeviceId = cameraDevices[currentDeviceIndex].deviceId;
        startCamera(nextDeviceId);
    }
}

/**
 * Mengambil satu frame foto mentah (RAW) dari video.
 * @returns {string} Data URL foto mentah.
 */
function capturePhoto() {
    const videoWidth = videoElement.videoWidth;
    const videoHeight = videoElement.videoHeight;
    
    const rawCanvas = document.createElement('canvas');
    rawCanvas.width = videoWidth;
    rawCanvas.height = videoHeight;
    const rawContext = rawCanvas.getContext('2d');
    
    rawContext.save(); 
    rawContext.scale(-1, 1);
    rawContext.drawImage(videoElement, videoWidth * -1, 0, videoWidth, videoHeight);
    rawContext.restore();

    return rawCanvas.toDataURL('image/png');
}

/**
 * Menjalankan sequence burst shot (3 foto berurutan)
 */
async function runBurstShot() {
    captureButton.disabled = true;
    downloadButton.disabled = true; 
    retakeButton.disabled = true; // BARU: Non-aktifkan Retake saat proses berjalan
    
    previewContainer.style.display = 'none'; 
    
    resultContainer.innerHTML = ''; 
    lastPhotoURL = null; 

    const selectedLayout = stripLayoutSelect.value;
    const capturedImages = [];

    resultContainer.classList.remove('grid-layout');
    if (selectedLayout === 'grid') {
        resultContainer.classList.add('grid-layout');
    }

    // 1. Ambil 3 foto mentah dengan countdown
    for (let i = 0; i < captureCount; i++) {
        await showCountdown(captureCount - i); 

        const rawImageURL = capturePhoto(); 
        capturedImages.push(rawImageURL); 

        await new Promise(resolve => setTimeout(resolve, 500)); 
    }

    // 2. Gabungkan 3 foto mentah ke dalam strip akhir dengan bingkai desain
    if (capturedImages.length === captureCount) {
        const finalStripURL = await createFinalStrip(capturedImages, selectedLayout);
        displayResult(finalStripURL); 
    }
    
    captureButton.disabled = false;
}

/**
 * Menggabungkan 3 foto ke dalam strip akhir dengan bingkai desain.
 * @param {string[]|null} imageURLs - Array of Data URLs (3 foto mentah), atau null/[] untuk frame kosong.
 * @param {string} layout - 'single' atau 'grid'.
 * @param {HTMLCanvasElement} [canvasTarget=finalCanvas] - Canvas target untuk menggambar.
 * @returns {Promise<string>} - Data URL strip foto akhir (hanya jika canvasTarget tidak diset).
 */
function createFinalStrip(imageURLs, layout, canvasTarget) {
    return new Promise(async (resolve) => {
        const finalCanvas = canvasTarget || document.createElement('canvas'); 
        const finalContext = finalCanvas.getContext('2d');
        
        // --- 1. Konfigurasi Dimensi dan Bingkai ---
        
        const FRAME_WIDTH = 280; 
        const FRAME_HEIGHT = 780;
        
        const STRIP_WIDTH = layout === 'grid' ? 420 : FRAME_WIDTH;
        const STRIP_HEIGHT = layout === 'grid' ? 420 : FRAME_HEIGHT;
        finalCanvas.width = STRIP_WIDTH;
        finalCanvas.height = STRIP_HEIGHT;

        const frameImage = layout === 'single' ? loadedFrameImages['single'] : loadedFrameImages['grid'];

        // --- KOREKSI KOORDINAT UNTUK FRAME-03.PNG ---
        const foto_w = 245;
        const foto_h = 160;
        const margin_x = 18;
        
        const margin_y_atas = 157; 
        const gap = 6; 

        const y2 = margin_y_atas + foto_h + gap;          
        const y3 = y2 + foto_h + gap;                     
        
        const coords = {
            single: [
                { x: margin_x, y: margin_y_atas, w: foto_w, h: foto_h }, 
                { x: margin_x, y: y2, w: foto_w, h: foto_h },             
                { x: margin_x, y: y3, w: foto_w, h: foto_h }              
            ],
            grid: [ 
                { x: 10, y: 10, w: 200, h: 200 },
                { x: 210, y: 10, w: 200, h: 200 },
                { x: 10, y: 210, w: 200, h: 200 }
            ]
        };

        const positions = coords[layout];
        
        // --- 2. Gambar Background (Hitam/Putih) ---
        finalContext.fillStyle = layout === 'single' ? '#f5f5f5' : '#111';
        finalContext.fillRect(0, 0, STRIP_WIDTH, STRIP_HEIGHT);

        // --- 3. Gambar Foto Mentah DULU (di layer bawah) ---
        if (imageURLs && imageURLs.length > 0) {
            const rawImages = await Promise.all(imageURLs.map(url => {
                return new Promise(imgResolve => {
                    const img = new Image();
                    img.onload = () => imgResolve(img);
                    img.src = url;
                });
            }));
            
            rawImages.forEach((img, index) => {
                if (positions[index]) {
                    const { x, y, w, h } = positions[index];
                    finalContext.drawImage(img, x, y, w, h);
                }
            });
        }
        
        // --- 4. Gambar Bingkai Desain DI ATAS foto ---
        if (frameImage && frameImage.complete) {
             finalContext.drawImage(frameImage, 0, 0, STRIP_WIDTH, STRIP_HEIGHT);
        } else {
             console.warn("Bingkai desain tidak dimuat. Menggunakan latar belakang fallback.");
        }
        
        // 5. Selesaikan
        if (!canvasTarget) {
            resolve(finalCanvas.toDataURL('image/jpeg', 0.9));
        } else {
            resolve();
        }
    });
}

/**
 * Menampilkan preview tata letak bingkai yang dipilih.
 */
async function updatePreview(layout) {
    if (Object.keys(loadedFrameImages).length === 0) {
         await loadFrameImages(); 
    }
    
    // Gunakan array kosong untuk membuat strip hanya berisi bingkai
    await createFinalStrip([], layout, previewCanvas);
    
    // Sesuaikan tata letak dan tampilkan
    previewContainer.style.display = 'block';
    
    // Sesuaikan lebar container agar pas dengan frame
    const FRAME_WIDTH = layout === 'grid' ? 420 : 280;
    previewContainer.style.maxWidth = `${FRAME_WIDTH}px`; 
}


/**
 * Menampilkan hasil foto pada strip gallery
 */
function displayResult(dataURL) {
    resultContainer.innerHTML = '';
    
    const img = document.createElement('img');
    img.src = dataURL;
    img.alt = 'Hasil Strip Foto';
    resultContainer.appendChild(img);
    
    lastPhotoURL = dataURL; 
    downloadButton.disabled = false; 
    retakeButton.disabled = false; // BARU: Aktifkan tombol Retake
}

/**
 * BARU: Fungsi untuk mengulang proses foto.
 */
function retakePhoto() {
    // 1. Bersihkan hasil
    resultContainer.innerHTML = '';
    lastPhotoURL = null; 

    // 2. Non-aktifkan tombol hasil
    downloadButton.disabled = true;
    retakeButton.disabled = true;

    // 3. Aktifkan kembali tombol Ambil Foto
    captureButton.disabled = false;

    // 4. Tampilkan kembali preview layout
    updatePreview(stripLayoutSelect.value);
}

/**
 * Fungsi untuk mengunduh foto yang terakhir diambil.
 */
function downloadPhoto() {
    if (lastPhotoURL) {
        const link = document.createElement('a');
        link.href = lastPhotoURL;
        
        // Beri nama file berdasarkan tanggal dan waktu
        const now = new Date();
        const filename = `photobooth-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}.jpeg`;
        
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } else {
        alert("Belum ada foto yang diambil untuk diunduh.");
    }
}

/**
 * Fungsi placeholder untuk countdown
 */
function showCountdown(number) {
    return new Promise(resolve => {
        const overlay = document.getElementById('overlay');
        overlay.innerHTML = `<div class="countdown">${number}</div>`;
        
        const countdownStyle = document.createElement('style');
        const existingStyle = document.querySelector('#countdown-style');
        if (existingStyle) existingStyle.remove();
        
        countdownStyle.id = 'countdown-style';
        countdownStyle.innerHTML = `
            .countdown {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                font-size: 8em;
                color: white;
                text-shadow: 0 0 10px black;
                animation: pulse 1s ease-out forwards;
            }
            @keyframes pulse {
                from { opacity: 0; transform: translate(-50%, -50%) scale(1.5); }
                to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
            }
        `;
        overlay.appendChild(countdownStyle);

        setTimeout(() => {
            overlay.innerHTML = '';
            resolve();
        }, 800);
    });
}


// --- Event Listeners ---
startButton.addEventListener('click', () => {
    loadFrameImages().then(() => {
        console.log('Semua bingkai desain siap.');
        getCameraDevices().then(() => {
            if (cameraDevices.length > 0) {
                startCamera(cameraDevices[0].deviceId);
            } else {
                alert("Tidak ada perangkat kamera ditemukan.");
            }
        });
    });
});

switchCameraButton.addEventListener('click', switchCamera);
captureButton.addEventListener('click', runBurstShot);
downloadButton.addEventListener('click', downloadPhoto); 
retakeButton.addEventListener('click', retakePhoto); // BARU: Event listener untuk Foto Ulang

// Event listener untuk ganti layout 
stripLayoutSelect.addEventListener('change', (e) => {
    updatePreview(e.target.value);
});

// Inisialisasi awal
loadFrameImages();