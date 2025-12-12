// Dapatkan referensi elemen DOM
const videoElement = document.getElementById('videoElement');
const canvasElement = document.getElementById('canvasElement');
const startButton = document.getElementById('startButton');
const captureButton = document.getElementById('captureButton');
const switchCameraButton = document.getElementById('switchCameraButton');
const downloadButton = document.getElementById('downloadButton');
const resultContainer = document.getElementById('resultContainer');
const stripLayoutSelect = document.getElementById('stripLayout');
const singleStripFrame = document.getElementById('singleStripFrame');
const gridStripFrame = document.getElementById('gridStripFrame');

// BARU UNTUK PREVIEW
const previewContainer = document.getElementById('previewContainer');
const previewCanvas = document.getElementById('previewCanvas');
let previewInterval = null;

let currentStream = null;
let cameraDevices = [];
let currentDeviceIndex = 0;
// Jumlah burst shot adalah 3
const captureCount = 3; 

let loadedFrameImages = {};
let lastPhotoURL = null; 

/**
 * Menghitung koordinat sumber (sX, sY, sW, sH) agar foto di-crop untuk mengisi ruang tujuan (dWH)
 * Ini mencegah foto menjadi gepeng (stretched/distorted).
 */
function calculateAspectFillCrop(sourceW, sourceH, destW, destH) {
    const sourceRatio = sourceW / sourceH;
    const destRatio = destW / destH;
    let sX, sY, sWidth, sHeight;

    if (sourceRatio > destRatio) {
        // Source lebih lebar dari tujuan, potong tepi horizontal
        sHeight = sourceH;
        sWidth = sourceH * destRatio;
        sX = (sourceW - sWidth) / 2;
        sY = 0;
    } else {
        // Source lebih tinggi dari tujuan, potong tepi vertikal
        sWidth = sourceW;
        sHeight = sourceW / destRatio;
        sX = 0;
        sY = (sourceH - sHeight) / 2;
    }

    return { sX, sY, sWidth, sHeight };
}

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
            // MULAI LOOP PREVIEW
            startPreviewLoop(); 
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
    // HENTIKAN LOOP PREVIEW SAAT CAPTURE DIMULAI
    stopPreviewLoop(); 
    captureButton.disabled = true;
    downloadButton.disabled = true;
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
        // Panggil showCountdown dengan delay 3000ms (3 detik)
        await showCountdown(3); 

        const rawImageURL = capturePhoto(); 
        capturedImages.push(rawImageURL); 

        // Jeda singkat setelah capture (untuk visual feedback)
        await new Promise(resolve => setTimeout(resolve, 500)); 
    }

    // 2. Gabungkan 3 foto mentah ke dalam strip akhir dengan bingkai desain
    if (capturedImages.length === captureCount) {
        const finalStripURL = await createFinalStrip(capturedImages, selectedLayout);
        displayResult(finalStripURL); 
    }
    
    captureButton.disabled = false;
    // MULAI LAGI LOOP PREVIEW
    startPreviewLoop(); 
}

/**
 * Menggabungkan 3 foto ke dalam strip akhir dengan bingkai desain.
 */
function createFinalStrip(imageURLs, layout) {
    return new Promise(async (resolve) => {
        const finalCanvas = document.createElement('canvas'); 
        const finalContext = finalCanvas.getContext('2d');
        
        // --- 1. Konfigurasi Dimensi dan Bingkai ---
        
        // KOREKSI DIMENSI DARI FRAME-03.PNG
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
        
        // Y PERTAMA (POSISI FOTO PERTAMA)
        const margin_y_atas = 157; 
        
        // GAP BARU
        const gap = 5; 

        // Kalkulasi Y untuk foto 2 dan 3 agar konsisten
        const y2 = margin_y_atas + foto_h + gap; // 170 + 160 + 5 = 335
        const y3 = y2 + foto_h + gap; // 335 + 160 + 5 = 500
        
        const coords = {
            single: [
                { x: margin_x, y: margin_y_atas, w: foto_w, h: foto_h }, // Foto 1 (y: 170)
                { x: margin_x, y: y2, w: foto_w, h: foto_h },             // Foto 2 (y: 335)
                { x: margin_x, y: y3, w: foto_w, h: foto_h }              // Foto 3 (y: 500)
            ],
            // Layout grid 3 foto 
            grid: [ 
                { x: 10, y: 10, w: 200, h: 200 },
                { x: 210, y: 10, w: 200, h: 200 },
                { x: 10, y: 210, w: 200, h: 200 }
            ]
        };

        const positions = coords[layout];
        
        const rawImages = await Promise.all(imageURLs.map(url => {
            return new Promise(imgResolve => {
                const img = new Image();
                img.onload = () => imgResolve(img);
                img.src = url;
            });
        }));
        
        // --- 2. Gambar Foto Mentah DULU (di layer bawah) ---
        rawImages.forEach((img, index) => {
            if (positions[index]) {
                const { x, y, w, h } = positions[index];
                
                // >>> PERBAIKAN PENTING: Hitung crop agar foto tidak gepeng
                const crop = calculateAspectFillCrop(img.width, img.height, w, h);

                // Gambar menggunakan 9 parameter drawImage
                finalContext.drawImage(
                    img, 
                    crop.sX, crop.sY, crop.sWidth, crop.sHeight, // Source (Apa yang di-crop dari foto mentah)
                    x, y, w, h                                  // Destination (Di mana digambar di kanvas akhir)
                );
            }
        });

        // --- 3. Gambar Bingkai Desain DI ATAS foto ---
        if (frameImage && frameImage.complete) {
             finalContext.drawImage(frameImage, 0, 0, STRIP_WIDTH, STRIP_HEIGHT);
        } else {
             finalContext.fillStyle = 'brown'; 
             finalContext.fillRect(0, 0, STRIP_WIDTH, STRIP_HEIGHT);
             console.warn("Bingkai desain tidak dimuat. Menggunakan latar belakang cokelat.");
        }
        
        // 4. Selesaikan
        resolve(finalCanvas.toDataURL('image/jpeg', 0.9));
    });
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
}

/**
 * Fungsi untuk mengunduh foto yang terakhir diambil.
 */
function downloadPhoto() {
    if (lastPhotoURL) {
        const link = document.createElement('a');
        link.href = lastPhotoURL;
        
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

// =======================================================
// >>> FUNGSI PREVIEW BARU <<<
// =======================================================

/**
 * Memulai perulangan preview frame.
 */
function startPreviewLoop() {
    if (previewInterval) {
        clearInterval(previewInterval);
    }
    if (previewContainer) {
        previewContainer.style.display = 'block'; 
    }
    
    // Jalankan updatePreview setiap 100ms (10 FPS)
    previewInterval = setInterval(updatePreview, 100);
}

/**
 * Menghentikan perulangan preview frame.
 */
function stopPreviewLoop() {
    if (previewInterval) {
        clearInterval(previewInterval);
        previewInterval = null;
    }
    if (previewContainer) {
        previewContainer.style.display = 'none'; 
    }
}

/**
 * Mengambil frame video, menggabungkannya dengan bingkai, dan menampilkannya di previewCanvas.
 */
function updatePreview() {
    if (!videoElement || videoElement.paused || videoElement.ended || !previewCanvas) return;

    const frameImage = loadedFrameImages['single']; 
    
    // Gunakan dimensi frame 1x3 Anda
    const FRAME_WIDTH = 280; 
    const FRAME_HEIGHT = 780;

    previewCanvas.width = FRAME_WIDTH;
    previewCanvas.height = FRAME_HEIGHT;
    const context = previewCanvas.getContext('2d');
    
    // Kordinat Lubang Foto 1 (HANYA FOTO 1 yang akan digunakan untuk preview)
    const margin_x = 18;
    const margin_y_atas = 170; 
    const foto_w = 245;
    const foto_h = 160;

    // 1. Hapus isi canvas
    context.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);

    // 2. Gambar frame video MENTAH ke lubang Foto 1
    // Gunakan canvas temporer untuk flip video sebelum digambar
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = videoElement.videoWidth;
    tempCanvas.height = videoElement.videoHeight;
    const tempCtx = tempCanvas.getContext('2d');
    
    // Gambar video (dengan flip) ke tempCanvas
    tempCtx.save(); 
    tempCtx.scale(-1, 1);
    tempCtx.drawImage(videoElement, tempCanvas.width * -1, 0, tempCanvas.width, tempCanvas.height);
    tempCtx.restore();

    // Hitung crop untuk frame video saat ini
    const crop = calculateAspectFillCrop(tempCanvas.width, tempCanvas.height, foto_w, foto_h);

    // Gambar Video ke posisi lubang F1 menggunakan crop
    context.drawImage(
        tempCanvas, 
        crop.sX, crop.sY, crop.sWidth, crop.sHeight, // Source
        margin_x, margin_y_atas, foto_w, foto_h       // Destination
    );
    
    // 3. Gambar Bingkai Desain di atas foto (Overlay)
    if (frameImage && frameImage.complete) {
        context.drawImage(frameImage, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
    }
}

/**
 * Fungsi untuk menampilkan countdown 3, 2, 1
 * @param {number} startNumber - Angka awal (selalu 3).
 */
function showCountdown(startNumber) {
    return new Promise(resolve => {
        const overlay = document.getElementById('overlay');
        overlay.innerHTML = ''; 
        
        const existingStyle = document.querySelector('#countdown-style');
        if (existingStyle) existingStyle.remove();
        
        const countdownStyle = document.createElement('style');
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
                opacity: 0;
            }
            @keyframes pulse {
                from { opacity: 0; transform: translate(-50%, -50%) scale(1.5); }
                to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
            }
        `;
        overlay.appendChild(countdownStyle);
        
        let count = startNumber;
        
        const updateCountdown = () => {
            if (count > 0) {
                overlay.innerHTML = `<div class="countdown">${count}</div>`;
                
                // Restart animasi pulse setiap detik
                const cdElement = overlay.querySelector('.countdown');
                cdElement.style.animation = 'none';
                void cdElement.offsetWidth;
                cdElement.style.animation = 'pulse 0.8s ease-out forwards';
                
                count--;
                // Panggil lagi setelah 1 detik
                setTimeout(updateCountdown, 1000);
            } else {
                // Selesai countdown
                overlay.innerHTML = '';
                resolve();
            }
        };

        // Mulai countdown 3, 2, 1
        updateCountdown();
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

// Inisialisasi awal
loadFrameImages();
