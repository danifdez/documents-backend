module.exports = {
  /**
   * @param db {import('mongodb').Db}
   * @returns {Promise<void>}
   */
  async up(db) {
    await db.collection('marks').createIndex(
      {
        content: 'text',
      },
      {
        name: 'marks_fulltext_idx',
        default_language: 'none',
      },
    );
  },

  /**
   * @param db {import('mongodb').Db}
   * @returns {Promise<void>}
   */
  async down(db) {
    await db.collection('marks').dropIndex('marks_fulltext_idx');
  },
};
