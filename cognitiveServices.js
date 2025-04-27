const sdk = require('microsoft-cognitiveservices-speech-sdk');

// Configure Speech Services
const speechConfig = sdk.SpeechConfig.fromSubscription(
  process.env.SPEECH_KEY, 
  process.env.SPEECH_REGION
);

// Speech-to-Text function
async function speechToText(audioData) {
  return new Promise((resolve, reject) => {
    const audioConfig = sdk.AudioConfig.fromWavFileInput(audioData);
    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
    
    recognizer.recognizeOnceAsync(result => {
      if (result.reason === sdk.ResultReason.RecognizedSpeech) {
        resolve(result.text);
      } else {
        reject(new Error('Speech recognition failed'));
      }
      recognizer.close();
    });
  });
}

// Text-to-Speech function
async function textToSpeech(text) {
  return new Promise((resolve, reject) => {
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig);
    
    synthesizer.speakTextAsync(
      text,
      result => {
        if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
          resolve(result.audioData);
        } else {
          reject(new Error('Speech synthesis failed'));
        }
        synthesizer.close();
      },
      error => {
        reject(error);
        synthesizer.close();
      }
    );
  });
}

module.exports = {
  speechToText,
  textToSpeech
};