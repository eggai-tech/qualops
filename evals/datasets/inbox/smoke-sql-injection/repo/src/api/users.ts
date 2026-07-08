import { Request, Response } from 'express';
import { db } from '../db';

export async function getUser(req: Request, res: Response) {
  const userId = req.params.id;
  const result = await db.query(`SELECT * FROM users WHERE id = '${userId}'`);
  res.json(result.rows[0]);
}
