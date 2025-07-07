const express = require('express');
const router = express.Router();
const { adminMiddleware } = require('../middleware/auth');
const Referral = require('../models/Referral');

// Get referral stats grouped by referrer
router.get('/', adminMiddleware, async (req, res) => {
  try {
    const referrals = await Referral.find().populate('referrer referredUser').lean();

    const statsMap = {};

    referrals.forEach((ref) => {
      const referrerId = ref.referrer?._id?.toString();
      if (!referrerId) return;

      if (!statsMap[referrerId]) {
        statsMap[referrerId] = {
          user: ref.referrer.fullName,
          referralCount: 0,
          bonusPaid: 0,
          isSuspicious: false,
        };
      }

      statsMap[referrerId].referralCount += 1;
      statsMap[referrerId].bonusPaid += ref.bonus || 0;
      statsMap[referrerId].isSuspicious = statsMap[referrerId].isSuspicious || ref.suspicious;
    });

    res.json(Object.values(statsMap));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
