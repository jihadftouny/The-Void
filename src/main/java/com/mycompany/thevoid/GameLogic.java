/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

import java.util.Scanner;

/**
 *
 * @author jihad
 */
public class GameLogic {
    
    //variables
    static Scanner scanner = new Scanner(System.in);
    static Player player;
    public static boolean isRunning;
    
    //random encounter variables
    public static String[] encounters = {"Battle","Battle","Battle","Rest","Rest"}; //this will be used as an rng factor, rest will show parts of the lore while giving xp
    public static String[] enemies = {"Ogre","Orc","Goblin","Kobolt","Rat"};
    
    //story variables
    public static int place = 0, act = 1;
    public static String[] places = {"First Floor","Second Floor","Third Floor","Fourth Floor","Fifth Floor"};
    
// ------- Main Game Methods ---------------------------------------------------   
    
    public static void startGame(){
        boolean nameSet = false;
        String name;
        
        //print title screen
        clearConsole();
        printDivider(40);
        printDivider(40);
        System.out.println("THE VOID\nA Text Rpg by Jihanger\nv0.0.1");
        printDivider(40);
        printDivider(40);
        anythingToContinue();
        
        //getting player name
        do{
            clearConsole();
            printHeader("What's your name?");
            name = scanner.next();
            clearConsole();
            printHeader("Your name is " + name + "\nIs that correct?");
            System.out.println("(1) Yes!\n(2) No, I want to change my name");
            int input = readInt("-> ", 2);
            if(input == 1)
                nameSet = true;
        }while(!nameSet);
        
        //create new player obejct
        player = new Player(name);
        Story.printIntro(player);
        
        isRunning = true;
        //start main game loop
        gameLoop();
    }
    
    public static void gameLoop(){
        while(isRunning){
            printMenu();
            int input = readInt("->", 3);
            if(input == 1)
                continueJourney();
            else if(input == 2)
                characterInfo();
            else
                isRunning = false;
        }
    }
    
    public static void checkAct(){
        if (player.xp >=10 && act == 1){
            act = 2;
            place = 1;
            Story.firstActOutro();
            player.chooseTrait();
            Story.secondActIntro();
            //assign new values to enemies
            enemies[0] = "Evil Jooj";
            enemies[1] = "Evil Jooj";
            enemies[2] = "Evil Jooj";
            enemies[3] = "Evil Jooj";
            enemies[4] = "Evil Jooj";
            //assign new values to encounters
            encounters[0] = "Battle";
            encounters[1] = "Battle";
            encounters[2] = "Battle";
            encounters[3] = "Rest";
            encounters[4] = "Rest";
            
        }else if (player.xp >=30 && act == 2){
            act = 3;
            place = 2;
            Story.secondActOutro();
            player.chooseTrait();
            Story.thirdActIntro();
            enemies[0] = "Evil Jooj";
            enemies[1] = "Evil Jooj";
            enemies[2] = "Evil Jooj";
            enemies[3] = "Evil Jooj";
            enemies[4] = "Evil Jooj";
        }else if (player.xp >=90 && act == 3){
            act = 4;
            place = 3;
            Story.thirdActOutro();
            player.chooseTrait();
            Story.fourthActIntro();
            enemies[0] = "Evil Jooj";
            enemies[1] = "Evil Jooj";
            enemies[2] = "Evil Jooj";
            enemies[3] = "Evil Jooj";
            enemies[4] = "Evil Jooj";
        }else if (player.xp >=240 && act == 4){
            act = 5;
            place = 4;
            Story.fourthActOutro();
            player.chooseTrait();
            Story.fifthActIntro();
            //call final battle
//            finalBattle();
        }
    }
    
    //method to continue journey 
    public static void continueJourney(){
//        checkAct();
        //check if game isnt in last act
        if(act!=5){
//                randomEncounter();
        }
    }
    
    public static void printMenu(){
        clearConsole();
        printHeader(places[place]);
        System.out.println("Choose an Action:");
        printDivider(20);
        System.out.println("(1) Continue on your descent");
        System.out.println("(2) Character Info");
        System.out.println("(3) Exit Game");
    }
    
    public static void characterInfo(){
        clearConsole();
        printHeader("CHARACTER INFORMATION");
        System.out.println(player.name + "\tHP: " + player.hp + "/" + player.maxHp);
        printDivider(20);
        System.out.println("XP: " + player.xp);
        
        //print chosen traits
        if(player.numAtkUpgrades > 0){
            System.out.println("\nOffensive trait: " + player.atkUpgrades[player.numAtkUpgrades - 1]);
            printDivider(20);
        }
        if(player.numDefUpgrades > 0){
            System.out.println("\nDefensive trait: " + player.defUpgrades[player.numDefUpgrades - 1]);
            printDivider(20);
        }
        anythingToContinue();
    }
    
    
    
// ------- Battle/Rest methods -----------------------------------------------
    
    public static void randomEcounter(){
        int encounter = (int) (Math.random() * encounters.length);
        
        switch (encounters[encounter]) {
//            randomBattle();
            case "Battle":
                break;
//            takeRest();
            case "Rest":
                break;
//            shop();
            default:
                break;
        }
        
    }
    
    //creating a random battle
    public static void randomBatle(){
        clearConsole();
        printHeader("You encountered an enemy. Fight for your life!");
        anythingToContinue();
        
        //creating new enemy with random name
        battle(new Enemy(enemies[(int)(Math.random()*enemies.length)], player.xp));
    }
    
    //main battle method
    public static void battle(Enemy enemy){
        //main abttle loop
        while(true){
            clearConsole();
            printHeader(enemy.name + "\nHP: " + enemy.hp + "/" + enemy.maxHp);
            printHeader(player.name + "\nHP: " + player.hp + "/" + player.maxHp);
        }
    }
    
// ------- UI methods ---------------------------------------------------
    
    //input method
    public static int readInt(String prompt, int userChoices){
        int input;
        
        do{
            System.out.print(prompt);
            try {
                input = Integer.parseInt(scanner.next());
            } catch (Exception e) {
                input = -1;
                System.out.print("Please enter an integer!");
            }
        }while(input < 1 || input > userChoices);
        return input;
    }
    
    //clear console
    public static void clearConsole(){
        for (int i = 0; i < 50; i++) {
            System.out.println("");
        }
    }
    
    //print line divider
    public static void printDivider(int dashes){
        for (int i = 0; i < dashes; i++) {
            System.out.print("-");
        }
        System.out.println("");
    }
    
    //print header
    public static void printHeader(String headerText){
        clearConsole();
        printDivider(40);
        System.out.println(headerText);
        printDivider(40);
        System.out.println("");
    }
    
    //press anything to continue
    public static void anythingToContinue(){
        System.out.println("Type something to continue...");
        scanner.next();
    }
    
    
    
}
