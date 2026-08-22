// Convert base64-encoded PCM (from Gemini TTS) into a playable WAV Blob.
export const pcmToWav = (value, sampleRate = 24000) => {
    const binaryString = atob(value);
    const len = binaryString.length;
    const buffer = new ArrayBuffer(len);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < len; i++) {
        view[i] = binaryString.charCodeAt(i);
    }
    const rawPcmData = new Int16Array(buffer);

    // Add Silence Padding (0.5s) to prevent browser audio cutoff
    const paddingSamples = Math.floor(sampleRate * 0.5);
    const pcmData = new Int16Array(rawPcmData.length + paddingSamples);
    pcmData.set(rawPcmData, paddingSamples);

    const wavBuffer = new ArrayBuffer(44 + pcmData.length * 2);
    const wavView = new DataView(wavBuffer);
    const writeString = (offset, string) => {
        for (let i = 0; i < string.length; i++) {
            wavView.setUint8(offset + i, string.charCodeAt(i));
        }
    };
    writeString(0, 'RIFF');
    wavView.setUint32(4, 36 + pcmData.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    wavView.setUint32(16, 16, true);
    wavView.setUint16(20, 1, true);
    wavView.setUint16(22, 1, true);
    wavView.setUint32(24, sampleRate, true);
    wavView.setUint32(28, sampleRate * 2, true);
    wavView.setUint16(32, 2, true);
    wavView.setUint16(34, 16, true);
    writeString(36, 'data');
    wavView.setUint32(40, pcmData.length * 2, true);
    const pcmView = new Int16Array(wavBuffer, 44);
    pcmView.set(pcmData);
    return new Blob([wavBuffer], { type: 'audio/wav' });
};
