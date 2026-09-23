const Feature = require('../models/Feature');
const Plan = require('../models/Plan');

/**
 * POST /api/admin/features
 * Add a new dynamic feature entry
 */
exports.createFeature = async (req, res) => {
  try {
    const { key, name, description, valueType, category, isActive } = req.body;

    if (!key || !name) {
      return res.status(400).json({
        success: false,
        message: 'Feature key and name are required.',
      });
    }

    const normalizedKey = key.toUpperCase().trim();
    const existing = await Feature.findOne({ key: normalizedKey });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `A feature with key "${normalizedKey}" already exists.`,
      });
    }

    const feature = new Feature({
      key: normalizedKey,
      name: name.trim(),
      description: description ? description.trim() : '',
      valueType: valueType || 'boolean',
      category: category || 'General',
      isActive: isActive !== undefined ? !!isActive : true,
    });

    await feature.save();

    return res.status(201).json({
      success: true,
      message: `Feature "${feature.name}" created successfully.`,
      feature,
    });
  } catch (error) {
    console.error('[FEATURE CONTROLLER] Create error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create feature.',
      error: error.message,
    });
  }
};

/**
 * GET /api/admin/features
 * List all dynamic features in the system
 */
exports.getAllFeatures = async (req, res) => {
  try {
    const { category, isActive } = req.query;
    const filter = {};

    if (category) {
      filter.category = category;
    }
    if (isActive !== undefined) {
      filter.isActive = isActive === 'true';
    }

    const features = await Feature.find(filter).sort({ category: 1, name: 1 });

    return res.status(200).json({
      success: true,
      totalCount: features.length,
      features,
    });
  } catch (error) {
    console.error('[FEATURE CONTROLLER] Get all error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch features.',
      error: error.message,
    });
  }
};

/**
 * PUT /api/admin/features/:id
 * Edit feature details or toggle isActive
 */
exports.updateFeature = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, valueType, category, isActive } = req.body;

    const feature = await Feature.findById(id);
    if (!feature) {
      return res.status(404).json({
        success: false,
        message: 'Feature not found.',
      });
    }

    if (name !== undefined) feature.name = name.trim();
    if (description !== undefined) feature.description = description.trim();
    if (valueType !== undefined) feature.valueType = valueType;
    if (category !== undefined) feature.category = category;
    if (isActive !== undefined) feature.isActive = !!isActive;

    await feature.save();

    return res.status(200).json({
      success: true,
      message: `Feature "${feature.name}" updated successfully.`,
      feature,
    });
  } catch (error) {
    console.error('[FEATURE CONTROLLER] Update error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update feature.',
      error: error.message,
    });
  }
};

/**
 * DELETE /api/admin/features/:id
 * Soft delete or remove feature
 */
exports.deleteFeature = async (req, res) => {
  try {
    const { id } = req.params;
    const { permanent } = req.query;

    const feature = await Feature.findById(id);
    if (!feature) {
      return res.status(404).json({
        success: false,
        message: 'Feature not found.',
      });
    }

    // Check if any active plans are referencing this feature
    const activePlansUsingFeature = await Plan.find({
      'features.featureKey': feature.key,
      isActive: true,
    }).select('name planKey');

    if (activePlansUsingFeature.length > 0 && permanent === 'true') {
      return res.status(400).json({
        success: false,
        message: `Cannot permanently delete feature. It is currently in use by active plans: ${activePlansUsingFeature.map(p => p.name).join(', ')}.`,
      });
    }

    if (permanent === 'true') {
      await Feature.findByIdAndDelete(id);
      return res.status(200).json({
        success: true,
        message: `Feature "${feature.name}" permanently deleted.`,
      });
    }

    // Default: Soft deactivation
    feature.isActive = false;
    await feature.save();

    return res.status(200).json({
      success: true,
      message: `Feature "${feature.name}" deactivated successfully.`,
      feature,
    });
  } catch (error) {
    console.error('[FEATURE CONTROLLER] Delete error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete/deactivate feature.',
      error: error.message,
    });
  }
};
