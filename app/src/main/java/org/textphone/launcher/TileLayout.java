package org.textphone.launcher;

import java.util.ArrayList;
import java.util.List;

/**
 * Today tile layout, the same as the browser's tile-layout.js; tools/fixtures/tile-layout-cases.json checks both. Tiles are
 * packed densely in order: each takes the first free spot, scanning row by row, where it fits, so small tiles fill gaps.
 */
final class TileLayout {
    /** One column's width, one row's height and the gap between cells, in pixels. */
    static final class Metrics {
        final float unit, rowUnit, gap;
        Metrics(float unit, float rowUnit, float gap) { this.unit = unit; this.rowUnit = rowUnit; this.gap = gap; }
    }
    static int columns(String size) { return "wide".equals(size) ? 4 : "small".equals(size) ? 1 : 2; }
    static int rows(String size) { return "small".equals(size) ? 1 : 2; }

    /** {col, row, cols, rows} for tile sizes in order, on a grid `columns` wide. */
    static int[][] pack(List<String> sizes, int columns) {
        List<boolean[]> used = new ArrayList<>(); int[][] cells = new int[sizes.size()][];
        for (int i = 0; i < sizes.size(); i++) {
            int cols = Math.min(columns(sizes.get(i)), columns), rows = rows(sizes.get(i)), at = 0;
            while (!free(used, at / columns, at % columns, cols, rows, columns)) at++;
            int row = at / columns, col = at % columns;
            while (used.size() < row + rows) used.add(new boolean[columns]);
            for (int r = row; r < row + rows; r++) for (int c = col; c < col + cols; c++) used.get(r)[c] = true;
            cells[i] = new int[]{col, row, cols, rows};
        }
        return cells;
    }
    private static boolean free(List<boolean[]> used, int row, int col, int cols, int rows, int columns) {
        if (col + cols > columns) return false;
        for (int r = row; r < Math.min(row + rows, used.size()); r++) for (int c = col; c < col + cols; c++) if (used.get(r)[c]) return false;
        return true;
    }
    /** {left, top, width, height} of a cell from the board's content origin. */
    static float[] box(int[] cell, Metrics m) {
        return new float[]{cell[0] * (m.unit + m.gap), cell[1] * (m.rowUnit + m.gap), cell[2] * m.unit + (cell[2] - 1) * m.gap, cell[3] * m.rowUnit + (cell[3] - 1) * m.gap};
    }

    /**
     * Where a dragged tile goes: the position in the order whose slot lies nearest the dragged tile's centre. `others` are
     * the other tiles' sizes in order. A move away from `current` must be clearly nearer, so a tile between two slots does not flicker.
     */
    static int dropIndex(List<String> others, String size, float x, float y, int columns, Metrics m, int current) {
        int best = 0; double nearest = Double.MAX_VALUE;
        for (int index = 0; index <= others.size(); index++) {
            double d = distance(others, size, index, x, y, columns, m);
            if (d < nearest) { nearest = d; best = index; }
        }
        if (current >= 0 && current <= others.size() && best != current
                && distance(others, size, current, x, y, columns, m) - nearest < 0.3 * Math.min(m.unit, m.rowUnit)) return current;
        return best;
    }
    private static double distance(List<String> others, String size, int index, float x, float y, int columns, Metrics m) {
        List<String> sizes = new ArrayList<>(others); sizes.add(index, size);
        float[] box = box(pack(sizes, columns)[index], m);
        return Math.hypot(box[0] + box[2] / 2 - x, box[1] + box[3] / 2 - y);
    }

    /** The size whose footprint is nearest the area a resize handle has been dragged to, in grid cells from the tile's corner. */
    static String snap(float cols, float rows) {
        String best = "small"; double nearest = Double.MAX_VALUE;
        for (String size : new String[]{"small", "square", "wide"}) {
            double d = Math.pow(columns(size) - cols, 2) + Math.pow(rows(size) - rows, 2);
            if (d < nearest) { nearest = d; best = size; }
        }
        return best;
    }
    private TileLayout() { }
}
