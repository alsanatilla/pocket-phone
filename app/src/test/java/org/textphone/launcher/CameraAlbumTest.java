package org.textphone.launcher;

import static org.junit.Assert.*;
import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileNotFoundException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import org.junit.Before;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import org.robolectric.util.ReflectionHelpers;
import org.robolectric.shadows.ShadowContentResolver;

@RunWith(RobolectricTestRunner.class)
@Config(sdk={24,35})
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class CameraAlbumTest {
    private Context c;private File jpeg,stored;private Library library;
    @Before public void setup()throws Exception{c=RuntimeEnvironment.getApplication();c.getSharedPreferences("pocket_camera",0).edit().clear().commit();c.getSharedPreferences("FilesActivity",0).edit().clear().commit();
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(Manifest.permission.READ_EXTERNAL_STORAGE);
        jpeg=File.createTempFile("pocket-real-image-",".jpg");Bitmap bitmap=Bitmap.createBitmap(20,10,Bitmap.Config.ARGB_8888);bitmap.eraseColor(0xFF778899);
        try(FileOutputStream output=new FileOutputStream(jpeg)){assertTrue(bitmap.compress(Bitmap.CompressFormat.JPEG,90,output));}bitmap.recycle();
        stored=File.createTempFile("pocket-published-image-",".jpg");library=new Library(stored);ProviderInfo info=new ProviderInfo();info.authority="media";info.exported=true;library.attachInfo(c,info);ShadowContentResolver.registerProviderInternal("media",library);
    }
    @After public void cleanup(){library.db.close();jpeg.delete();stored.delete();}
    private Uri capture()throws Exception{return PhotoStore.save(c,jpeg,"DSC_capture.JPG",20,10,3000);}
    @Test public void captureAppearsWithoutFolderAccessAndOtherImagesAreExcluded()throws Exception{
        Uri camera=capture();library.row(99,"DSC_foreign.JPG","DCIM/Pocket/","other.camera",4000);library.row(100,"DSC_elsewhere.JPG","Pictures/",c.getPackageName(),5000);
        assertEquals(1,CameraAlbum.list(c).size());assertEquals(camera,CameraAlbum.list(c).get(0).uri);
        ActivityController<FilesActivity> controller=Robolectric.buildActivity(FilesActivity.class).setup();try{FilesActivity activity=controller.get();settle(activity);
            assertNull(PocketAppsTest.find(activity.body,"Choose folder"));assertNull(PocketAppsTest.find(activity.body,"Open file"));assertNull(Shadows.shadowOf(activity).getLastRequestedPermission());
            android.widget.TextView photo=findContaining(activity.body,"DSC_capture.JPG");assertNotNull(photo);assertNull(findContaining(activity.body,"DSC_foreign.JPG"));photo.performClick();settle(activity);
            Bitmap shown=ReflectionHelpers.getField(activity,"bitmap");assertNotNull(shown);assertEquals(20,shown.getWidth());assertEquals(10,shown.getHeight());assertNotNull(PocketAppsTest.find(activity.root,"Share photo"));
        }finally{controller.pause().stop().destroy();}
    }
    @Test public void arbitraryImagesCannotBeOpenedByPassingAnIntent()throws Exception{
        capture();library.row(99,"DSC_foreign.JPG","DCIM/Pocket/","other.camera",4000);
        int opensBefore=library.opens;
        ActivityController<FilesActivity> controller=Robolectric.buildActivity(FilesActivity.class,new Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse("content://media/external/images/media/99"),"image/jpeg")).setup();
        try{FilesActivity activity=controller.get();settle(activity);assertEquals(opensBefore,library.opens);assertNotNull(PocketAppsTest.find(activity.body,"This photo is unavailable or was not taken with Pocket Camera."));}
        finally{controller.pause().stop().destroy();}
    }
    @Test public void openingAlbumReleasesOldBrowserGrantsWithoutDeletingPhotos()throws Exception{
        Uri camera=capture();Uri folder=Uri.parse("content://fixture.documents/tree/root");c.getContentResolver().takePersistableUriPermission(folder,Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        c.getSharedPreferences("FilesActivity",0).edit().putString("tree",folder.toString()).commit();
        ActivityController<FilesActivity> controller=Robolectric.buildActivity(FilesActivity.class).setup();try{settle(controller.get());assertTrue(c.getContentResolver().getPersistedUriPermissions().isEmpty());
            assertNull(controller.get().getPreferences(0).getString("tree",null));assertEquals(camera,CameraAlbum.list(c).get(0).uri);
        }finally{controller.pause().stop().destroy();}
    }
    @Test public void deletedPhotosDisappearOnRefresh()throws Exception{
        Uri camera=capture();ActivityController<FilesActivity> controller=Robolectric.buildActivity(FilesActivity.class).setup();try{FilesActivity activity=controller.get();settle(activity);
            c.getContentResolver().delete(camera,null,null);PocketAppsTest.find(activity.body,"Refresh").performClick();settle(activity);
            assertNotNull(PocketAppsTest.find(activity.body,"No Pocket photos yet. Take a picture with Pocket Camera and it will appear here."));
        }finally{controller.pause().stop().destroy();}
    }
    @Test @Config(sdk=35) public void previousVersionCapturesAreRecoveredByNativeOwnership()throws Exception{
        library.row(21,"DSC_old.JPG","DCIM/Pocket/",c.getPackageName(),2000);assertEquals(1,CameraAlbum.list(c).size());assertEquals("DSC_old.JPG",CameraAlbum.list(c).get(0).name);
    }
    @Test public void photoNavigationStaysWithinTheOwnedAlbumAndRetainsTheSelectedPhoto()throws Exception{
        Uri first=capture();Uri second=PhotoStore.save(c,jpeg,"DSC_second.JPG",20,10,6000);library.row(99,"DSC_foreign.JPG","DCIM/Pocket/","other.camera",9000);
        ActivityController<FilesActivity> controller=Robolectric.buildActivity(FilesActivity.class,new Intent().setData(second)).setup();
        try{FilesActivity activity=controller.get();settle(activity);assertFalse(activity.root.findViewWithTag("photo_previous").isEnabled());assertTrue(activity.root.findViewWithTag("photo_next").isEnabled());activity.root.findViewWithTag("photo_next").performClick();settle(activity);
            assertEquals(first,ReflectionHelpers.getField(activity,"opened"));assertFalse(activity.root.findViewWithTag("photo_next").isEnabled());assertTrue(activity.root.findViewWithTag("photo_previous").isEnabled());
            controller.recreate();activity=controller.get();settle(activity);assertEquals(first,ReflectionHelpers.getField(activity,"opened"));activity.root.findViewWithTag("photo_previous").performClick();settle(activity);assertEquals(second,ReflectionHelpers.getField(activity,"opened"));
            PocketAppsTest.find(activity.root,"Share photo").performClick();Intent chooser=Shadows.shadowOf(activity).getNextStartedActivity();Intent send=chooser.getParcelableExtra(Intent.EXTRA_INTENT);assertEquals(second,send.getParcelableExtra(Intent.EXTRA_STREAM));assertEquals(second,send.getClipData().getItemAt(0).getUri());assertTrue((send.getFlags()&Intent.FLAG_GRANT_READ_URI_PERMISSION)!=0);
        }finally{controller.pause().stop().destroy();}
    }
    static void settle(PocketActivity activity)throws Exception{ExecutorService worker=ReflectionHelpers.getField(activity,"worker");for(int i=0;i<4;i++){worker.submit(()->{}).get(5,TimeUnit.SECONDS);Shadows.shadowOf(Looper.getMainLooper()).idle();}}
    static android.widget.TextView findContaining(android.view.View view,String text){if(view instanceof android.widget.TextView&&((android.widget.TextView)view).getText().toString().contains(text))return (android.widget.TextView)view;
        if(view instanceof android.view.ViewGroup)for(int i=0;i<((android.view.ViewGroup)view).getChildCount();i++){android.widget.TextView found=findContaining(((android.view.ViewGroup)view).getChildAt(i),text);if(found!=null)return found;}return null;}
    static final class Library extends ContentProvider{
        final File jpeg;final SQLiteDatabase db=SQLiteDatabase.create(null);int opens;Library(File jpeg){this.jpeg=jpeg;db.execSQL("CREATE TABLE photos (_id INTEGER PRIMARY KEY, _display_name TEXT, mime_type TEXT, width INTEGER, height INTEGER, datetaken INTEGER, relative_path TEXT, owner_package_name TEXT, is_pending INTEGER, _data TEXT)");}
        public boolean onCreate(){return true;}void row(long id,String name,String path,String owner,long taken){ContentValues values=new ContentValues();values.put("_id",id);values.put("_display_name",name);values.put("relative_path",path);values.put("owner_package_name",owner);values.put("datetaken",taken);values.put("mime_type","image/jpeg");values.put("is_pending",0);db.insertOrThrow("photos",null,values);}
        public Uri insert(Uri uri,ContentValues values){ContentValues stored=new ContentValues(values);stored.put("owner_package_name",getContext().getPackageName());if(!stored.containsKey("is_pending"))stored.put("is_pending",0);long id=db.insertOrThrow("photos",null,stored);return android.content.ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,id);}
        private String individual(Uri uri,String selection){return uri.getLastPathSegment().matches("[0-9]+")?"_id = "+Long.parseLong(uri.getLastPathSegment()):selection;}
        public Cursor query(Uri uri,String[] p,String s,String[] a,String order){String selected=individual(uri,s);return db.query("photos",p,selected,selected==s?a:null,null,null,order);}
        public int update(Uri uri,ContentValues values,String s,String[] a){return db.update("photos",values,individual(uri,s),a);}public int delete(Uri uri,String s,String[] a){return db.delete("photos",individual(uri,s),a);}
        public String getType(Uri uri){return "image/jpeg";}public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException{opens++;return ParcelFileDescriptor.open(jpeg,ParcelFileDescriptor.parseMode(mode));}
    }
}
