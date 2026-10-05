package org.textphone.launcher;

import static org.junit.Assert.*;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class MovementScoresTest {
    @Test public void corosTextPreservesActivityUnitsAndNightlyDates() {
        String text="1. Run — 2026-10-05\nLabelId: 123456\nSportType: 100\nDistance: 6200 m\nDuration: 00:38:00\nAvg HR: 145\nLocation: Fixture park\nstartTimestamp=1791187200\n2. Swim — 2026-10-04\nLabelId: 98765\nSportType: 400\nDistance: 1.5 km\nDuration: 30:00\nAvg HR: 120";
        List<CorosData.Activity> records=CorosData.records(text,ZoneId.of("Europe/Berlin"));
        assertEquals(2,records.size()); assertEquals(6.2,records.get(0).km,0.001); assertEquals(2280,records.get(0).seconds); assertEquals(145,records.get(0).hr);
        assertEquals(1800,records.get(1).seconds);
        List<CorosData.Hrv> hrv=CorosData.hrv("2026-10-05:\nHRV Avg: 60 ms\nNormal Range: 50 - 70\nBaseline: 60\nSleep HRV Time Series\n2026-10-04:\nHRV Avg: 1 ms");
        assertEquals(1,hrv.size()); assertEquals(60,hrv.get(0).baseline);
        Map<LocalDate,CorosData.Day> daily=CorosData.daily("--- 20261005 ---\nSteps: 6,500\nTotal: 7h 30min | Deep: 1h | Awake: 20min\n");
        CorosData.Day day=daily.get(LocalDate.of(2026,10,5)); assertEquals(6500,day.steps); assertEquals(450,day.sleep); assertEquals(20,day.awake);
    }
    @Test public void scoreResponseToReadingsAndMissingDataMatchesWebRules() {
        LocalDate date=LocalDate.of(2026,10,5); Map<LocalDate,Integer> resting=new HashMap<>();
        for(int i=1;i<=10;i++)resting.put(date.minusDays(i),55+(i%3)-1); resting.put(date,55);
        Map<LocalDate,CorosData.Day> daily=new HashMap<>(); CorosData.Day night=new CorosData.Day(); night.sleep=410; daily.put(date,night);
        List<CorosData.Hrv> hrv=new ArrayList<>(); hrv.add(new CorosData.Hrv(date,60,50,70,60));
        Scores.Recovery normal=Scores.recovery(date,hrv,resting,daily,0); assertTrue(normal.score>=52&&normal.score<=66);
        hrv.set(0,new CorosData.Hrv(date,75,50,70,60)); resting.put(date,50); night.sleep=500;
        assertTrue(Scores.recovery(date,hrv,resting,daily,0).score>=67);
        hrv.set(0,new CorosData.Hrv(date,45,50,70,60)); resting.put(date,62); night.sleep=300;
        assertTrue(Scores.recovery(date,hrv,resting,daily,0).score<34);
        assertNull(Scores.recovery(date,new ArrayList<>(),new HashMap<>(),daily,0));
        assertEquals(180,Scores.maxHeartRate(40,0)); assertEquals(190,Scores.maxHeartRate(40,205));
        assertEquals(100,Scores.strainOf(150)); assertTrue(Scores.strainOf(300)>100);
    }
    @Test public void workoutsAndStepsDoNotDoubleCountAndConditioningNeedsHistory() {
        LocalDate today=LocalDate.of(2026,10,5); ZoneId zone=ZoneId.of("Europe/Berlin");
        List<CorosData.Activity> activities=new ArrayList<>();
        for(int i=0;i<30;i++)activities.add(new CorosData.Activity("fixture"+i,100,"Run",today.minusDays(i*3).atTime(8,0).atZone(zone).toInstant().toEpochMilli(),8,2700,150));
        Map<LocalDate,CorosData.Day> daily=new HashMap<>(); CorosData.Day day=new CorosData.Day(); day.steps=10400;daily.put(today,day);
        Map<LocalDate,Integer> resting=new HashMap<>(); resting.put(today,55);
        Scores.Result result=Scores.compute(today,zone,activities,new ArrayList<>(),resting,daily,40,false);
        assertEquals(1,result.strain.workouts); assertEquals(0,result.strain.passive,0); assertTrue(result.strain.strain>50);
        assertTrue(result.conditioning.score>0); assertNotEquals("calibrating",result.conditioning.status);
        assertEquals("calibrating",Scores.cardioStatus(20,10,10,7));
    }
}
