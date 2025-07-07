const express = require('express');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const adminController = require('../controllers/adminController');
const router = express.Router();

// Admin Authentication
router.post('/login', adminController.login);

// Admin Profile
router.get('/profile', [authMiddleware, adminMiddleware], adminController.getProfile);
router.put('/profile', [authMiddleware, adminMiddleware], adminController.updateProfile);

// Dashboard Stats
router.get('/dashboard-stats', [authMiddleware, adminMiddleware], adminController.getDashboardStats);

// User Management

// User Management
router.get('/users', [authMiddleware, adminMiddleware], adminController.getUsers);

router.get('/users/pending-confirmations', [authMiddleware, adminMiddleware], adminController.getPendingConfirmations); // ✅ Move this up

router.get('/users/:id', [authMiddleware, adminMiddleware], adminController.getUserDetails);
router.put('/users/:id/status', [authMiddleware, adminMiddleware], adminController.updateUserStatus);
router.delete('/users/:id', [authMiddleware, adminMiddleware], adminController.deleteUser);
router.post('/users/:id/reset-password', [authMiddleware, adminMiddleware], adminController.resetUserPassword);
router.post('/users/:id/confirm-email', [authMiddleware, adminMiddleware], adminController.confirmUserEmail);
router.post('/users/:id/resend-confirmation', [authMiddleware, adminMiddleware], adminController.resendConfirmation);


// Task Management
router.get('/tasks', [authMiddleware, adminMiddleware], adminController.getTasks);
router.post('/tasks', [authMiddleware, adminMiddleware], adminController.createTask);
router.post('/tasks/:id/archive', [authMiddleware, adminMiddleware], adminController.archiveTask);
router.post('/tasks/:id/unarchive', [authMiddleware, adminMiddleware], adminController.unarchiveTask);
router.delete('/tasks/:id', [authMiddleware, adminMiddleware], adminController.deleteTask);

// Withdrawal Management
router.get('/withdrawals', [authMiddleware, adminMiddleware], adminController.getWithdrawals);
router.post('/withdrawals/:id/approve', [authMiddleware, adminMiddleware], adminController.approveWithdrawal);
router.post('/withdrawals/:id/decline', [authMiddleware, adminMiddleware], adminController.declineWithdrawal);
router.post('/withdrawals/:id/paid', [authMiddleware, adminMiddleware], adminController.markWithdrawalAsPaid);

// Referral Management
router.get('/referrals', [authMiddleware, adminMiddleware], adminController.getReferrals);

// Upgrade Management
router.get('/upgrades', [authMiddleware, adminMiddleware], adminController.getUpgrades);
router.post('/upgrades/:id/approve', [authMiddleware, adminMiddleware], adminController.approveUpgrade);
router.post('/upgrades/:id/reject', [authMiddleware, adminMiddleware], adminController.rejectUpgrade);

// Admin Management
router.get('/admins', [authMiddleware, adminMiddleware], adminController.getAdmins);
router.post('/invite', [authMiddleware, adminMiddleware], adminController.inviteAdmin);

// Email Logs
router.get('/emails', [authMiddleware, adminMiddleware], adminController.getEmailLogs);

// Notifications
router.post('/notifications', [authMiddleware, adminMiddleware], adminController.sendNotification);

module.exports = router;