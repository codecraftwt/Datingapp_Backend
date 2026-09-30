const ContactReport = require('../models/ContactReport');

/**
 * POST /api/contact/submit or /api/contact
 * Public endpoint to submit a Contact-Us issue/report from login or app
 */
exports.submitReport = async (req, res) => {
  try {
    const { name, email, phone, subject, message } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Problem description / message is required.',
      });
    }

    const newReport = new ContactReport({
      name: name ? name.trim() : 'Guest User',
      email: email ? email.trim().toLowerCase() : '',
      phone: phone ? phone.trim() : '',
      subject: subject && subject.trim().length > 0 ? subject.trim() : 'General Inquiry / App Problem',
      message: message.trim(),
      status: 'pending',
    });

    await newReport.save();

    return res.status(201).json({
      success: true,
      message: 'Your report has been submitted successfully! Our support team will review it shortly.',
      report: newReport,
    });
  } catch (error) {
    console.error('submitReport error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while submitting report. Please try again later.',
      error: error.message,
    });
  }
};
/**
 * GET /api/contact/my-reports
 * User endpoint to fetch their submitted Contact Support reports
 */
exports.getMySubmittedContactReports = async (req, res) => {
  try {
    let email = (req.user && req.user.email) ? req.user.email.trim().toLowerCase() : '';
    if (!email && req.query.email) {
      email = req.query.email.trim().toLowerCase();
    }

    if (!email) {
      return res.status(200).json({
        success: true,
        reports: [],
      });
    }

    const reports = await ContactReport.find({ email })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      message: 'Fetched user support reports successfully.',
      reports,
    });
  } catch (error) {
    console.error('getMySubmittedContactReports error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error fetching user support reports.',
      error: error.message,
    });
  }
};
/**
 * GET /api/admin/contact-reports
 * Admin endpoint to fetch all submitted contact-us reports
 */
exports.getAllContactReports = async (req, res) => {
  try {
    const { status, search } = req.query;
    const filter = {};

    if (status && status !== 'all') {
      filter.status = status.trim().toLowerCase();
    }

    if (search && search.trim().length > 0) {
      const regex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { name: regex },
        { email: regex },
        { phone: regex },
        { subject: regex },
        { message: regex },
      ];
    }

    const totalCount = await ContactReport.countDocuments({});
    const pendingCount = await ContactReport.countDocuments({ status: 'pending' });
    const inProgressCount = await ContactReport.countDocuments({ status: 'in-progress' });
    const resolvedCount = await ContactReport.countDocuments({ status: 'resolved' });

    const reports = await ContactReport.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      message: 'Fetched contact reports successfully.',
      analytics: {
        total: totalCount,
        pending: pendingCount,
        inProgress: inProgressCount,
        resolved: resolvedCount,
      },
      reports,
    });
  } catch (error) {
    console.error('getAllContactReports error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error fetching contact reports.',
      error: error.message,
    });
  }
};

/**
 * PUT /api/admin/contact-reports/:id
 * Admin endpoint to update report status or admin notes
 */
exports.updateContactReportStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    const updateObj = {};
    if (status && ['pending', 'in-progress', 'resolved'].includes(status.trim().toLowerCase())) {
      updateObj.status = status.trim().toLowerCase();
    }
    if (adminNotes !== undefined) {
      updateObj.adminNotes = adminNotes;
    }

    const updatedReport = await ContactReport.findByIdAndUpdate(id, updateObj, { new: true });
    if (!updatedReport) {
      return res.status(404).json({
        success: false,
        message: 'Contact report not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: `Report status updated to ${updatedReport.status}.`,
      report: updatedReport,
    });
  } catch (error) {
    console.error('updateContactReportStatus error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error updating contact report status.',
      error: error.message,
    });
  }
};

/**
 * DELETE /api/admin/contact-reports/:id
 * Admin endpoint to delete a contact report
 */
exports.deleteContactReport = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await ContactReport.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Report not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Contact report deleted successfully.',
    });
  } catch (error) {
    console.error('deleteContactReport error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error deleting report.',
      error: error.message,
    });
  }
};
