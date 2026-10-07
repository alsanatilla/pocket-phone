package org.textphone.launcher;

import android.content.Context;
import android.util.AttributeSet;
import android.view.View;
import android.view.ViewGroup;

/** Commands at their natural widths, left-aligned, that continue on the next line instead of being squeezed into equal cells. */
final class WrapRow extends ViewGroup {
    WrapRow(Context context) { super(context); }

    /** The margin of the first child: a command's text lines up with the content edge, and so does the first command of each wrapped line. */
    private int lineStart() {
        for (int i = 0; i < getChildCount(); i++) { View child = getChildAt(i); if (child.getVisibility() != GONE) return ((MarginLayoutParams) child.getLayoutParams()).leftMargin; }
        return 0;
    }

    @Override protected void onMeasure(int widthSpec, int heightSpec) {
        int available = Math.max(0, MeasureSpec.getSize(widthSpec) - getPaddingLeft() - getPaddingRight()), start = lineStart();
        int x = 0, y = 0, rowHeight = 0, widest = 0;
        for (int i = 0; i < getChildCount(); i++) {
            View child = getChildAt(i); if (child.getVisibility() == GONE) continue;
            MarginLayoutParams cell = (MarginLayoutParams) child.getLayoutParams();
            child.measure(MeasureSpec.makeMeasureSpec(Math.max(0, available - cell.leftMargin - cell.rightMargin), MeasureSpec.AT_MOST),
                    MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED));
            int width = child.getMeasuredWidth() + cell.leftMargin + cell.rightMargin, height = child.getMeasuredHeight() + cell.topMargin + cell.bottomMargin;
            if (x > 0 && x + width > available) { x = 0; y += rowHeight; rowHeight = 0; }
            if (x == 0) width += start - cell.leftMargin;
            x += width; rowHeight = Math.max(rowHeight, height); widest = Math.max(widest, x);
        }
        setMeasuredDimension(resolveSize(widest + getPaddingLeft() + getPaddingRight(), widthSpec),
                resolveSize(y + rowHeight + getPaddingTop() + getPaddingBottom(), heightSpec));
    }

    @Override protected void onLayout(boolean changed, int left, int top, int right, int bottom) {
        int available = Math.max(0, right - left - getPaddingLeft() - getPaddingRight()), start = lineStart();
        int x = 0, y = 0, rowHeight = 0;
        for (int i = 0; i < getChildCount(); i++) {
            View child = getChildAt(i); if (child.getVisibility() == GONE) continue;
            MarginLayoutParams cell = (MarginLayoutParams) child.getLayoutParams();
            int width = child.getMeasuredWidth() + cell.leftMargin + cell.rightMargin, height = child.getMeasuredHeight() + cell.topMargin + cell.bottomMargin;
            if (x > 0 && x + width > available) { x = 0; y += rowHeight; rowHeight = 0; }
            int margin = x == 0 ? start : cell.leftMargin;
            width += margin - cell.leftMargin;
            int childLeft = getPaddingLeft() + x + margin, childTop = getPaddingTop() + y + cell.topMargin;
            child.layout(childLeft, childTop, childLeft + child.getMeasuredWidth(), childTop + child.getMeasuredHeight());
            x += width; rowHeight = Math.max(rowHeight, height);
        }
    }

    @Override public LayoutParams generateLayoutParams(AttributeSet attributes) { return new MarginLayoutParams(getContext(), attributes); }
    @Override protected LayoutParams generateDefaultLayoutParams() { return new MarginLayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT); }
    @Override protected LayoutParams generateLayoutParams(LayoutParams params) { return new MarginLayoutParams(params); }
    @Override protected boolean checkLayoutParams(LayoutParams params) { return params instanceof MarginLayoutParams; }
}
