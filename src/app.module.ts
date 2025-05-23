import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProjectModule } from './project/project.module';
import { ThreadModule } from './thread/thread.module';
import { DocModule } from './doc/doc.module';
import { ResourceModule } from './resource/resource.module';
import { ResourceTypeModule } from './resource-type/resource-type.module';
import { FileStorageModule } from './file-storage/file-storage.module';
import { ExtractionModule } from './extraction/extraction.module';
import { JobModule } from './job/job.module';
import { ScheduleModule } from '@nestjs/schedule';
import { TaskScheduleModule } from './task-schedule/task-schedule.module';
import { JobProcessorModule } from './job-processor/job-processor.module';
import { NotificationModule } from './notification/notification.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ProjectModule,
    ThreadModule,
    DocModule,
    ResourceModule,
    ResourceTypeModule,
    FileStorageModule,
    ExtractionModule,
    JobModule,
    JobProcessorModule,
    TaskScheduleModule,
    NotificationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
