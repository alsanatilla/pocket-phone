package org.textphone.launcher;

import android.os.Bundle;
import android.text.InputType;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.text.Editable;
import android.text.TextWatcher;
import org.json.JSONArray;

public final class CalculatorActivity extends PocketActivity {
    private EditText expression;
    private TextView context;
    private boolean calculated, changing;
    @Override protected void onCreate(Bundle state) { super.onCreate(state); screen("calculator");
        expression = input("0", InputType.TYPE_CLASS_TEXT); expression.setTag("calculator_input");
        expression.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(512)});
        expression.setTextSize(PocketDesign.typeSize(this,32));
        expression.setText(state == null ? getPreferences(0).getString("expression", "") : state.getString("expression", ""));
        calculated=state==null?getPreferences(0).getBoolean("calculated",false):state.getBoolean("calculated");
        expression.setSingleLine(true);expression.setSelection(expression.length());expression.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_DONE);
        expression.setOnEditorActionListener((view,action,event)->{if(action==android.view.inputmethod.EditorInfo.IME_ACTION_DONE){try{equalsValue();}catch(IllegalArgumentException error){message(error.getMessage());}return true;}return false;});
        expression.addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence s,int start,int count,int after){}public void onTextChanged(CharSequence s,int start,int before,int count){if(!changing)calculated=false;}public void afterTextChanged(Editable e){}});
        context=label(state==null?getPreferences(0).getString("last_calculation",""):state.getString("last_calculation",""),12,GRAY);context.setTag("calculator_context");context.setVisibility(context.length()==0?android.view.View.GONE:android.view.View.VISIBLE);body.addView(context);
        String[] cells = {"C", "(", ")", "⌫", "7", "8", "9", "÷", "4", "5", "6", "×", "1", "2", "3", "−", "0", ".", "%", "+"};
        for (int r = 0; r < cells.length; r += 4) { LinearLayout row = row();
            for (int c = 0; c < 4; c++) { String key = cells[r + c]; row.addView(button(key, () -> press(key)), new LinearLayout.LayoutParams(0, dp(56), 1)); } body.addView(row); }
        android.widget.Button equals = action("=", this::equalsValue); equals.setTag("calculator_equals"); PocketDesign.primary(equals);
        keys(new String[]{"history","copy"},this::history,()->{String value=expression.getText().toString();if(value.trim().isEmpty()){message("Enter a calculation first.");return;}android.content.ClipboardManager clipboard=getSystemService(android.content.ClipboardManager.class);if(clipboard!=null){clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Calculation",value));message("Copied.");}});
    }
    private void history(){try { JSONArray items = new JSONArray(getPreferences(0).getString("history", "[]"));
            if(items.length()==0){message("No calculations yet.");return;}
            String[] values = new String[items.length()]; for (int i = 0; i < values.length; i++) values[i] = items.getString(i);
            new android.app.AlertDialog.Builder(this).setTitle("History").setItems(values, (d, i) -> {
                int separator=values[i].lastIndexOf(" = ");if(separator<0){message("History entry unavailable.");return;}setExpression(values[i].substring(separator+3),true);setContext(values[i]); }).setNegativeButton("Close", null)
                .setNeutralButton("Clear history",(d,w)->confirm("Clear calculation history?",()->getPreferences(0).edit().remove("history").apply())).show();
        } catch (org.json.JSONException e) { message("History unavailable."); }
    }
    private void setExpression(String value,boolean result){changing=true;try{expression.setText(value);expression.setSelection(expression.length());}finally{changing=false;}calculated=result;}
    private void setContext(String value){context.setText(value);context.setVisibility(value.isEmpty()?android.view.View.GONE:android.view.View.VISIBLE);}
    private void press(String key) {
        if ("C".equals(key)) {setExpression("",false);setContext("");message("");}
        else if ("⌫".equals(key)) { int start = Math.max(0, expression.getSelectionStart()), end = Math.max(start, expression.getSelectionEnd());
            if (start == end && start > 0) start--; expression.getText().delete(start, end); }
        else { int start = Math.max(0, expression.getSelectionStart()), end = Math.max(start, expression.getSelectionEnd());
            if(calculated&&("0123456789.(".contains(key))){setExpression("",false);start=end=0;}else calculated=false;
            if (expression.length() < 512) expression.getText().replace(start, end, key); }
    }
    private void equalsValue() { String original = expression.getText().toString(); String result = Expression.calculate(original);
        try { JSONArray old = new JSONArray(getPreferences(0).getString("history", "[]")), next = new JSONArray();
            next.put(original + " = " + result); for (int i = 0; i < Math.min(19, old.length()); i++) next.put(old.get(i));
            getPreferences(0).edit().putString("history", next.toString()).apply();
        } catch (org.json.JSONException ignored) { /* The calculation remains usable if history is invalid. */ }
        setExpression(result,true);setContext(original+" = "+result);message("");
    }
    @Override protected void onPause() { getPreferences(0).edit().putString("expression", expression.getText().toString()).putBoolean("calculated",calculated).putString("last_calculation",context.getText().toString()).apply(); super.onPause(); }
    @Override protected void onSaveInstanceState(Bundle out) { out.putString("expression", expression.getText().toString());out.putBoolean("calculated",calculated);out.putString("last_calculation",context.getText().toString()); super.onSaveInstanceState(out); }
}
