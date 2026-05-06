/**
 * JSDoc typedefs only (no runtime).
 * @typedef {{ text: string, choices: string[], correctIndex: number, timeSec: number, points?: number }} QuizQuestion
 * @typedef {{ title: string, questions: QuizQuestion[] }} Quiz
 * @typedef {{ id: string, name: string, score: number }} PlayerState
 * @typedef {{ pin: string, hostSecret: string, quiz: Quiz, phase: 'lobby'|'question'|'reveal'|'finished', questionIndex: number, players: Map<string, PlayerState>, answersThisRound: Map<string, { choiceIndex: number, answeredAt: number }>, createdAt: number }} GameSession
 */

module.exports = {};
