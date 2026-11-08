using System;
using System.Collections.Generic;

namespace BunkerBuster
{
    /// <summary>
    /// Port of generateMaze(random), cellCenter(cell), the maze constants and the
    /// "a few extra openings" loop from reset() in bunker-buster.js.
    /// Random calls happen in the same order as the JS, so identical streams give identical passages.
    /// </summary>
    public static class MazeGenerator
    {
        public const int Columns = 7;
        public const int Rows = 10;
        public const int Room = 5;
        public const int Stride = 8;
        public const int MidCol = Columns / 2;
        public const int FirstCell = MidCol;
        public const int LastCell = (Rows - 1) * Columns + MidCol;

        private const int MaxAttempts = 96;
        private const int MinLastDistance = 34;
        private const int MaxCentralOpen = 4;

        /// <summary>JS generateMaze(random): randomized depth-first traversal, retried until constraints hold.</summary>
        public static List<(int From, int To)> Generate(Func<double> random)
        {
            int total = Columns * Rows;
            for (int attempt = 0; attempt < MaxAttempts; attempt++)
            {
                var distance = new int[total];
                Array.Fill(distance, -1);
                var route = new List<int> { FirstCell };
                var passages = new List<(int From, int To)>();
                distance[FirstCell] = 0;
                int centralOpen = 0;
                var options = new List<int>(4);

                while (route.Count > 0)
                {
                    int cell = route[route.Count - 1];
                    int col = cell % Columns, row = cell / Columns;
                    options.Clear();
                    if (col > 0 && distance[cell - 1] < 0) options.Add(cell - 1);
                    if (col < Columns - 1 && distance[cell + 1] < 0) options.Add(cell + 1);
                    if (row > 0 && distance[cell - Columns] < 0) options.Add(cell - Columns);
                    if (row < Rows - 1 && distance[cell + Columns] < 0) options.Add(cell + Columns);
                    if (options.Count == 0) { route.RemoveAt(route.Count - 1); continue; }

                    int next = options[(int)Math.Floor(random() * options.Count)];
                    passages.Add((cell, next));
                    distance[next] = distance[cell] + 1;
                    if (col == MidCol && next % Columns == MidCol) centralOpen++;
                    route.Add(next);
                }

                if (distance[LastCell] >= MinLastDistance && centralOpen <= MaxCentralOpen) return passages;
            }

            // Serpentine fallback, same as the JS.
            var snake = new int[total];
            for (int i = 0; i < total; i++)
            {
                int row = i / Columns, col = i % Columns;
                snake[i] = row * Columns + (row % 2 != 0 ? Columns - 1 - col : col);
            }
            var result = new List<(int From, int To)>(total - 1);
            for (int i = 1; i < total; i++) result.Add((snake[i - 1], snake[i]));
            return result;
        }

        /// <summary>JS "a few extra openings" loop: adds round(columns*rows*.08) random passages (loops).</summary>
        public static void AddExtraOpenings(List<(int, int)> passages, Func<double> random)
        {
            int count = (int)Math.Floor(Columns * Rows * 0.08 + 0.5);
            for (int k = 0; k < count; k++)
            {
                int cell = (int)Math.Floor(random() * Columns * Rows);
                bool right = random() < 0.5;
                int col = cell % Columns, row = cell / Columns;
                if (right && col < Columns - 1) passages.Add((cell, cell + 1));
                else if (!right && row < Rows - 1) passages.Add((cell, cell + Columns));
            }
        }

        /// <summary>JS cellCenter(cell): world-space center of a room (x, z) in voxel units.</summary>
        public static (float X, float Z) CellCenter(int cell)
        {
            return (1 + cell % Columns * Stride + Room / 2f,
                    1 + cell / Columns * Stride + Room / 2f);
        }
    }

    /// <summary>Deterministic mulberry32 PRNG; NextDouble() returns [0,1) like the JS version.</summary>
    public sealed class Mulberry32
    {
        private uint _state;

        public Mulberry32(uint seed) { _state = seed; }

        public double NextDouble()
        {
            unchecked
            {
                _state += 0x6D2B79F5u;
                uint t = _state;
                t = (t ^ (t >> 15)) * (t | 1u);
                t ^= t + (t ^ (t >> 7)) * (t | 61u);
                return (t ^ (t >> 14)) / 4294967296.0;
            }
        }
    }
}
