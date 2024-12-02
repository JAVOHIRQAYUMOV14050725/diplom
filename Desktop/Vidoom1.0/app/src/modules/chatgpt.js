const config = require('../config');
const Logger = require('../Logger');

const log = new Logger('chatGPT');

function initializeChatGPT() {
    if (!config.chatGPT.enabled) {
        return null;
    }

    if (!config.chatGPT.apiKey) {
        log.warn('ChatGPT seems enabled, but you are missing the apiKey!');
        return null;
    }

    const { OpenAI } = require('openai');
    const configuration = {
        basePath: config.chatGPT.basePath,
        apiKey: config.chatGPT.apiKey,
    };
    return new OpenAI(configuration);
}

module.exports = initializeChatGPT;