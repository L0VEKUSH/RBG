/**
 * APIFeatures - Advanced query builder for MongoDB/Mongoose
 * Supports: filtering, sorting, field limiting, pagination, keyword search
 */
class APIFeatures {
  constructor(query, queryString) {
    this.query = query;
    this.queryString = queryString;
  }

  /**
   * Filter results based on query parameters
   * Supports: gte, gt, lte, lt operators
   */
  filter() {
    const queryObj = { ...this.queryString };
    const excludedFields = ['page', 'sort', 'limit', 'fields', 'keyword'];
    excludedFields.forEach((field) => delete queryObj[field]);

    // Advanced filtering: convert operators to MongoDB format
    let queryStr = JSON.stringify(queryObj);
    queryStr = queryStr.replace(/\b(gte|gt|lte|lt)\b/g, (match) => `$${match}`);

    this.query = this.query.find(JSON.parse(queryStr));
    return this;
  }

  /**
   * Sort results
   * Default: sort by createdAt descending
   */
  sort() {
    if (this.queryString.sort) {
      const sortBy = this.queryString.sort.split(',').join(' ');
      this.query = this.query.sort(sortBy);
    } else {
      this.query = this.query.sort('-createdAt');
    }
    return this;
  }

  /**
   * Limit fields in response (field projection)
   */
  limitFields() {
    if (this.queryString.fields) {
      const fields = this.queryString.fields.split(',').join(' ');
      this.query = this.query.select(fields);
    } else {
      this.query = this.query.select('-__v');
    }
    return this;
  }

  /**
   * Paginate results
   * Default: page 1, limit 10
   */
  paginate() {
    const page = parseInt(this.queryString.page, 10) || 1;
    const limit = parseInt(this.queryString.limit, 10) || 10;
    const skip = (page - 1) * limit;

    this.query = this.query.skip(skip).limit(limit);
    this.page = page;
    this.limit = limit;
    return this;
  }

  /**
   * Full-text search on specified fields
   * @param {string[]} fields - Fields to search in
   */
  search(fields = ['name']) {
    if (this.queryString.keyword) {
      const keyword = this.queryString.keyword;
      const searchQuery = {
        $or: fields.map((field) => ({
          [field]: { $regex: keyword, $options: 'i' },
        })),
      };
      this.query = this.query.find(searchQuery);
    }
    return this;
  }
}

module.exports = APIFeatures;
