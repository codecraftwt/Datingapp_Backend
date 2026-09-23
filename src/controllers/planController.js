const Plan = require('../models/Plan');
const Feature = require('../models/Feature');
const Stripe = require('stripe');

let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  try {
    stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  } catch (err) {
    console.warn('[PLAN CONTROLLER] Stripe initialization warning:', err.message);
  }
}

/**
 * POST /api/admin/plans
 * Admin creates a new subscription plan with selected features & limits.
 * Automatically provisions Product & Price on Stripe if Stripe is configured.
 */
exports.createPlan = async (req, res) => {
  try {
    const {
      planKey,
      name,
      description,
      price,
      currency = 'USD',
      billingCycle = 'monthly',
      stripeProductId,
      stripePriceId,
      features = [],
      highlightBadge,
      displayOrder,
      isActive = true,
      autoCreateStripeProduct = true,
    } = req.body;

    if (!planKey || !name || price === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Plan key, name, and price are required.',
      });
    }

    const normalizedPlanKey = planKey.trim();
    const existing = await Plan.findOne({ planKey: normalizedPlanKey });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `A plan with key "${normalizedPlanKey}" already exists.`,
      });
    }

    let finalStripeProductId = stripeProductId || '';
    let finalStripePriceId = stripePriceId || '';

    // Auto-create Stripe Product and Price if requested and price > 0
    if (stripe && price > 0 && autoCreateStripeProduct && (!finalStripeProductId || !finalStripePriceId)) {
      try {
        console.log(`💳 [STRIPE SYNC] Creating product "${name}" on Stripe Dashboard...`);
        const product = await stripe.products.create({
          name: name.trim(),
          description: description ? description.trim() : undefined,
          metadata: {
            planKey: normalizedPlanKey,
            managedBy: 'AdminPanel',
          },
        });
        finalStripeProductId = product.id;

        const interval = billingCycle === 'yearly' ? 'year' : 'month';
        const unitAmount = Math.round(parseFloat(price) * 100);

        console.log(`💳 [STRIPE SYNC] Creating recurring price (${price} ${currency}/${interval}) for product ${product.id}...`);
        const stripePrice = await stripe.prices.create({
          product: product.id,
          unit_amount: unitAmount,
          currency: currency.toLowerCase(),
          recurring: { interval },
          metadata: {
            planKey: normalizedPlanKey,
          },
        });
        finalStripePriceId = stripePrice.id;

        console.log(`✅ [STRIPE SYNC SUCCESS] Created Product: ${finalStripeProductId}, Price: ${finalStripePriceId}`);
      } catch (stripeErr) {
        console.error('⚠️ [STRIPE SYNC ERROR] Failed to auto-create on Stripe:', stripeErr.message);
        // Continue creating in MongoDB even if Stripe auto-provisioning had warning
      }
    }

    // Process and validate feature mappings
    const formattedFeatures = [];
    if (Array.isArray(features)) {
      for (const f of features) {
        const key = (f.featureKey || f.key || '').toUpperCase().trim();
        if (key) {
          const featureDoc = await Feature.findOne({ key });
          formattedFeatures.push({
            featureId: featureDoc ? featureDoc._id : f.featureId,
            featureKey: key,
            isAllowed: f.isAllowed !== undefined ? !!f.isAllowed : true,
            limitValue: f.limitValue !== undefined ? Number(f.limitValue) : -1,
          });
        }
      }
    }

    const plan = new Plan({
      planKey: normalizedPlanKey,
      name: name.trim(),
      description: description ? description.trim() : '',
      price: parseFloat(price) || 0,
      currency: currency.toUpperCase(),
      billingCycle,
      stripeProductId: finalStripeProductId,
      stripePriceId: finalStripePriceId,
      features: formattedFeatures,
      highlightBadge: highlightBadge ? highlightBadge.trim() : '',
      displayOrder: displayOrder !== undefined ? parseInt(displayOrder, 10) : 0,
      isActive: !!isActive,
    });

    await plan.save();

    return res.status(201).json({
      success: true,
      message: `Subscription plan "${plan.name}" created successfully.`,
      plan,
    });
  } catch (error) {
    console.error('[PLAN CONTROLLER] Create error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create subscription plan.',
      error: error.message,
    });
  }
};

/**
 * GET /api/admin/plans
 * Admin views all plans (active & inactive) populated with feature details
 */
exports.getAllPlans = async (req, res) => {
  try {
    const { isActive } = req.query;
    const filter = {};
    if (isActive !== undefined) {
      filter.isActive = isActive === 'true';
    }

    const plans = await Plan.find(filter)
      .populate('features.featureId')
      .sort({ displayOrder: 1, price: 1 });

    return res.status(200).json({
      success: true,
      totalCount: plans.length,
      plans,
    });
  } catch (error) {
    console.error('[PLAN CONTROLLER] Get all error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch subscription plans.',
      error: error.message,
    });
  }
};

/**
 * PUT /api/admin/plans/:id
 * Admin updates plan price, Stripe IDs, features, or limits
 */
exports.updatePlan = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      price,
      currency,
      billingCycle,
      stripeProductId,
      stripePriceId,
      features,
      highlightBadge,
      displayOrder,
      isActive,
    } = req.body;

    const plan = await Plan.findById(id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Subscription plan not found.',
      });
    }

    if (name !== undefined) plan.name = name.trim();
    if (description !== undefined) plan.description = description.trim();
    if (price !== undefined) plan.price = parseFloat(price);
    if (currency !== undefined) plan.currency = currency.toUpperCase();
    if (billingCycle !== undefined) plan.billingCycle = billingCycle;
    if (stripeProductId !== undefined) plan.stripeProductId = stripeProductId.trim();
    if (stripePriceId !== undefined) plan.stripePriceId = stripePriceId.trim();
    if (highlightBadge !== undefined) plan.highlightBadge = highlightBadge.trim();
    if (displayOrder !== undefined) plan.displayOrder = parseInt(displayOrder, 10);
    if (isActive !== undefined) plan.isActive = !!isActive;

    if (Array.isArray(features)) {
      const formattedFeatures = [];
      for (const f of features) {
        const key = (f.featureKey || f.key || '').toUpperCase().trim();
        if (key) {
          const featureDoc = await Feature.findOne({ key });
          formattedFeatures.push({
            featureId: featureDoc ? featureDoc._id : f.featureId,
            featureKey: key,
            isAllowed: f.isAllowed !== undefined ? !!f.isAllowed : true,
            limitValue: f.limitValue !== undefined ? Number(f.limitValue) : -1,
          });
        }
      }
      plan.features = formattedFeatures;
    }

    await plan.save();

    return res.status(200).json({
      success: true,
      message: `Plan "${plan.name}" updated successfully.`,
      plan,
    });
  } catch (error) {
    console.error('[PLAN CONTROLLER] Update error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update subscription plan.',
      error: error.message,
    });
  }
};

/**
 * DELETE /api/admin/plans/:id
 * Soft-delete or deactivate plan
 */
exports.deletePlan = async (req, res) => {
  try {
    const { id } = req.params;
    const { permanent } = req.query;

    const plan = await Plan.findById(id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Subscription plan not found.',
      });
    }

    if (permanent === 'true') {
      await Plan.findByIdAndDelete(id);
      return res.status(200).json({
        success: true,
        message: `Plan "${plan.name}" permanently deleted.`,
      });
    }

    // Default: Soft deactivation
    plan.isActive = false;
    await plan.save();

    return res.status(200).json({
      success: true,
      message: `Plan "${plan.name}" deactivated successfully.`,
      plan,
    });
  } catch (error) {
    console.error('[PLAN CONTROLLER] Delete error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete/deactivate plan.',
      error: error.message,
    });
  }
};
