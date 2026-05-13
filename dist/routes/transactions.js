const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// GET toutes les transactions
router.get('/', async (req, res) => {
  try {
    const transactions = await prisma.transaction.findMany({
      include: {
        user: {
          select: { 
            id: true,
            name: true, 
            email: true,
            role: true
          }
        }
      },
      orderBy: { 
        createdAt: 'desc' 
      }
    });
    
    res.json({
      success: true,
      data: transactions,
      count: transactions.length
    });
  } catch (error) {
    console.error('Erreur récupération transactions:', error);
    res.status(500).json({ 
      success: false,
      error: 'Erreur lors de la récupération des transactions',
      details: error.message 
    });
  }
});

// GET transaction par ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const transaction = await prisma.transaction.findUnique({
      where: { 
        id: parseInt(id) 
      },
      include: {
        user: {
          select: { 
            id: true,
            name: true, 
            email: true,
            role: true
          }
        }
      }
    });

    if (!transaction) {
      return res.status(404).json({ 
        success: false,
        error: 'Transaction non trouvée' 
      });
    }

    res.json({
      success: true,
      data: transaction
    });
  } catch (error) {
    console.error('Erreur récupération transaction:', error);
    res.status(500).json({ 
      success: false,
      error: 'Erreur lors de la récupération de la transaction',
      details: error.message 
    });
  }
});

// POST - Créer une nouvelle transaction
router.post('/', async (req, res) => {
  try {
    const { userId, department, prix, description, type } = req.body;

    // Validation des champs requis
    if (!userId || !department || !prix) {
      return res.status(400).json({
        success: false,
        error: 'Champs manquants',
        details: 'userId, department et prix sont requis'
      });
    }

    // Vérifier que l'utilisateur existe
    const user = await prisma.user.findUnique({
      where: { id: parseInt(userId) }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Utilisateur non trouvé',
        details: `L'utilisateur avec l'ID ${userId} n'existe pas`
      });
    }

    // Vérifier que le département est valide
    const validDepartments = ['hotel', 'restaurant', 'pub', 'spa'];
    if (!validDepartments.includes(department)) {
      return res.status(400).json({
        success: false,
        error: 'Département invalide',
        details: `Le département doit être l'un des suivants: ${validDepartments.join(', ')}`
      });
    }

    // Vérifier que le prix est positif
    if (parseFloat(prix) <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Prix invalide',
        details: 'Le prix doit être supérieur à 0'
      });
    }

    // Créer la transaction
    const transaction = await prisma.transaction.create({
      data: {
        userId: parseInt(userId),
        department: department,
        prix: parseFloat(prix),
        description: description || '',
        type: type || 'DEBIT'
      },
      include: {
        user: {
          select: { 
            id: true,
            name: true, 
            email: true,
            role: true
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      message: 'Transaction créée avec succès',
      data: transaction
    });

  } catch (error) {
    console.error('Erreur création transaction:', error);
    res.status(500).json({ 
      success: false,
      error: 'Erreur lors de la création de la transaction',
      details: error.message 
    });
  }
});

// GET transactions par utilisateur
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const transactions = await prisma.transaction.findMany({
      where: { 
        userId: parseInt(userId) 
      },
      include: {
        user: {
          select: { 
            id: true,
            name: true, 
            email: true,
            role: true
          }
        }
      },
      orderBy: { 
        createdAt: 'desc' 
      }
    });

    res.json({
      success: true,
      data: transactions,
      count: transactions.length
    });
  } catch (error) {
    console.error('Erreur récupération transactions utilisateur:', error);
    res.status(500).json({ 
      success: false,
      error: 'Erreur lors de la récupération des transactions',
      details: error.message 
    });
  }
});

// GET transactions par département
router.get('/department/:department', async (req, res) => {
  try {
    const { department } = req.params;
    
    const transactions = await prisma.transaction.findMany({
      where: { 
        department: department 
      },
      include: {
        user: {
          select: { 
            id: true,
            name: true, 
            email: true,
            role: true
          }
        }
      },
      orderBy: { 
        createdAt: 'desc' 
      }
    });

    res.json({
      success: true,
      data: transactions,
      count: transactions.length
    });
  } catch (error) {
    console.error('Erreur récupération transactions département:', error);
    res.status(500).json({ 
      success: false,
      error: 'Erreur lors de la récupération des transactions',
      details: error.message 
    });
  }
});

module.exports = router;