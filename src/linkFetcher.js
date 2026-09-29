const { extractVideoId, fetchComments, fetchVideoDetails } = require('./youtube');

module.exports = {
  extractVideoId,
  extractShortcode: extractVideoId,
  fetchComments,
  fetchCommentsForVideo: fetchComments,
  fetchCommentsForPost: async (id) => {
    const res = await fetchComments(id);
    return res.comments;
  },
  fetchVideoDetails,
};
