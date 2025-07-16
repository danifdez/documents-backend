module.exports = {
  /**
   * @param db {import('mongodb').Db}
   * @returns {Promise<void>}
   */
  async up(db) {
    await db.collection('resources').createIndex(
      {
        title: 'text',
        name: 'text',
        content: 'text',
      },
      {
        name: 'resources_fulltext_idx',
        default_language: 'none',
        weights: {
          title: 10,
          name: 8,
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
    await db.collection('resources').dropIndex('resources_fulltext_idx');
  },
};
