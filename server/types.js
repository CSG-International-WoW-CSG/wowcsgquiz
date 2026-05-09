/**
 * JSDoc typedefs only (no runtime).
 * @typedef {{ text: string, choices: string[], correctIndex: number, timeSec: number, points?: number }} QuizQuestion
 * @typedef {{ title: string, questions: QuizQuestion[] }} Quiz
 * @typedef {{ id: string, name: string, score: number, connected: boolean, lastSeenAt: number }} PlayerState
 * @typedef {{ questionIndex: number, correctIndex: number, totalAnswers: number, correctAnswers: number, avgResponseMs: number, choiceCounts: number[], createdAt: number }} QuestionAnalytics
 * @typedef {{ pin: string, hostSecret: string, hostName: string, hostToken: string, quiz: Quiz, phase: 'lobby'|'question'|'reveal'|'finished', questionIndex: number, players: Map<string, PlayerState>, answersThisRound: Map<string, { choiceIndex: number, answeredAt: number }>, questionStartedAt?: number, analytics: QuestionAnalytics[], createdAt: number }} GameSession
 */

module.exports = {};
