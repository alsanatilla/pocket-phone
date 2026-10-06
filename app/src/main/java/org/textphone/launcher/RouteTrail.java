package org.textphone.launcher;

import android.os.Bundle;
import java.util.ArrayDeque;
import java.util.ArrayList;

/** Logical history is independent of PageMotion's small visual cache. */
final class RouteTrail {
    static final class Route {
        final String page, kind, assigning, appsReturn, appQuery;
        final long id;
        Route(String page,long id,String kind,String assigning,String appsReturn,String appQuery) {
            this.page=page;this.id=id;this.kind=kind;this.assigning=assigning;this.appsReturn=appsReturn;this.appQuery=appQuery;
        }
        String key() {
            if ("capture".equals(page)||"note_preview".equals(page)) return page+":"+kind+":"+id;
            if ("task_detail".equals(page)||"thought_detail".equals(page)) return page+":"+id;
            if ("assign".equals(page)) return page+":"+assigning;
            return page;
        }
        Bundle bundle() { Bundle b=new Bundle();b.putString("page",page);b.putLong("id",id);b.putString("kind",kind);b.putString("assign",assigning);b.putString("return",appsReturn);b.putString("query",appQuery);return b; }
        static Route read(Bundle b) {return new Route(b.getString("page","home"),b.getLong("id"),b.getString("kind","note"),b.getString("assign"),b.getString("return","home"),b.getString("query",""));}
    }
    private final ArrayDeque<Route> routes=new ArrayDeque<>();
    Route peek(){return routes.peekLast();}
    Route pop(){return routes.pollLast();}
    void clear(){routes.clear();}
    void push(Route route){if(route==null)return;if(peek()!=null&&peek().key().equals(route.key()))return;if(routes.size()==24)routes.removeFirst();routes.addLast(route);}
    Route take(String key){boolean found=false;for(Route r:routes)if(r.key().equals(key))found=true;if(!found)return null;Route r;do{r=pop();}while(!r.key().equals(key));return r;}
    Bundle save(){Bundle b=new Bundle();ArrayList<Bundle> all=new ArrayList<>();for(Route r:routes)all.add(r.bundle());b.putParcelableArrayList("routes",all);return b;}
    void restore(Bundle b){clear();if(b==null)return;ArrayList<Bundle> all=b.getParcelableArrayList("routes");if(all!=null)for(Bundle r:all)push(Route.read(r));}
}
