// server/services/youtube.js
const { google } = require('googleapis');
const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY,
});

async function validateYouTubeVideo(videoId) {
  try {
    const response = await youtube.videos.list({
      part: 'id',
      id: videoId,
    });
    return response.data.items.length > 0;
  } catch (err) {
    console.error('YouTube API error:', err.message);
    throw new Error('Failed to validate video');
  }
}

module.exports = { validateYouTubeVideo };