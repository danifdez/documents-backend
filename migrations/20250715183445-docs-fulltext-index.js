module.exports = {
  /**
   * @param db {import('mongodb').Db}
   * @returns {Promise<void>}
   */
  async up(db) {
    await db.collection('docs').createIndex(
      {
        name: 'text',
        content: 'text',
      },
      {
        name: 'docs_fulltext_idx',
        default_language: 'none',
        weights: {
          name: 10,
          content: 5,
        },
      },
    );
  },

  /**
   * @param db {import('mongodb').Db}
   * @returns {Promise<void>}
   */
  async down(db) {
    await db.collection('docs').dropIndex('docs_fulltext_idx');
  },
};
